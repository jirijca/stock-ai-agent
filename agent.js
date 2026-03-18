import "dotenv/config";
import nodemailer from "nodemailer";
import Parser from "rss-parser";
import { Groq } from "groq-sdk";
import fs from "fs/promises";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const parser = new Parser();

// --- KONFIGURACE ---
const STOCKS = ["MSFT", "NVDA", "ASML", "RIOT", "O", "MDB", "V", "AVGO", "IREN", "GOOG", "TSLA"]; 
const EMAIL_RECIPIENT = "jirijca@gmail.com";
const BATCH_SIZE = 5; 

// --- POMOCNÉ FUNKCE PRO DATA ---

async function getPortfolio() {
    try {
        const data = await fs.readFile("./portfolio.json", "utf-8");
        return JSON.parse(data);
    } catch (e) {
        console.warn("⚠️ portfolio.json nenalezen. Pokračuji bez dat portfolia.");
        return {};
    }
}

async function getHistory() {
    try {
        const data = await fs.readFile("./history.json", "utf-8");
        return JSON.parse(data);
    } catch (e) {
        console.warn("⚠️ history.json nenalezen. Inicializuji novou historii.");
        return {};
    }
}

async function saveHistory(results) {
    try {
        const history = {};
        results.forEach(r => {
            history[r.ticker] = {
                price: r.price,
                date: new Date().toISOString(),
                analysis: r.analysis
            };
        });
        await fs.writeFile("./history.json", JSON.stringify(history, null, 2));
        console.log("💾 Historie uložena do history.json");
    } catch (e) {
        console.error("❌ Nepodařilo se uložit historii:", e.message);
    }
}

// --- ANALÝZA A ZÍSKÁVÁNÍ DAT ---

async function getStockAnalysis(ticker, data, portfolioInfo, lastHistory) {
    if (!data.news || data.news.length === 0) return "⚠️ Nedostatek čerstvých zpráv pro relevatní analýzu.";
    
    let portfolioContext = "Není v portfoliu.";
    if (portfolioInfo) {
        const pnl = ((data.price - portfolioInfo.avgPrice) / portfolioInfo.avgPrice) * 100;
        portfolioContext = `POZOR: Máš v tom peníze! Držíš ${portfolioInfo.shares} ks, tvůj aktuální zisk/ztráta je ${pnl.toFixed(2)}%.`;
    }

    let historyContext = "";
    if (lastHistory) {
        const diff = ((data.price - lastHistory.price) / lastHistory.price) * 100;
        historyContext = `Od včerejška se cena pohnula o ${diff.toFixed(2)}%.`;
    }

    const systemPrompt = `Jsi elitní seniorní analytik z Wall Street. Tvým úkolem je poskytnout bleskový, NEKOMPROMISNÍ komentář k akcii. 
    Nepoužívej fráze jako 'analytik říká' nebo 'podle stránek'. Jdi přímo k věci. 
    Hledej souvislost mezi zprávami a pohybem ceny. Buď kritický. 
    Struktura: 1. Co se děje teď. 2. Dopad na tvoji pozici/portfolio. 3. Verdikt.
    Odpovídej česky, stručně, max 3-4 úderné věty.`;

    const userPrompt = `
    AKTIVA: ${ticker} | CENA: ${data.price} USD (${data.change.toFixed(2)}%)
    HISTORICKÝ POSUN: ${historyContext}
    PORTFOLIO KONTEXT: ${portfolioContext}
    ROZSAH 52 TÝDNŮ: ${data.metrics.range}
    TITULKY ZPRÁV: ${data.news.map(n => n.title).join(" | ")}
    `;

    try {
        const response = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.2, // Snížení na 0.2 zajistí, že AI bude méně "ukecaná" a více faktická
        });
        return response.choices[0]?.message?.content || "Analýza selhala.";
    } catch (e) { return "Chyba AI modulu."; }
}

async function getStockData(ticker) {
    try {
        // POUŽITÍ STABILNÍHO V8 ENDPOINTU
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`);
        const json = await res.json();
        
        const result = json.chart?.result?.[0];
        if (!result) {
            console.warn(`⚠️ Yahoo nevrátilo data pro ${ticker}`);
            return null;
        }

        const meta = result.meta;
        const price = meta.regularMarketPrice;
        const prevClose = meta.previousClose;
        const change = ((price - prevClose) / prevClose) * 100;

        const metrics = {
            range: `${meta.fiftyTwoWeekLow?.toFixed(2) || '?'} - ${meta.fiftyTwoWeekHigh?.toFixed(2) || '?'}`
        };

        const feed = await parser.parseURL(`https://news.google.com/rss/search?q=${ticker}+stock+news&hl=en-US`);
        const limitDate = new Date();
        limitDate.setHours(limitDate.getHours() - 48);

        const recentNews = feed.items
            .filter(item => new Date(item.pubDate) > limitDate)
            .map(n => ({
                ticker,
                title: n.title,
                link: n.link,
                date: new Date(n.pubDate),
                dateStr: new Date(n.pubDate).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })
            }));

        return {
            ticker,
            price,
            change,
            metrics,
            news: recentNews.slice(0, 3),
            allRecentNews: recentNews
        };
    } catch (err) {
        console.error(`❌ Kritická chyba u ${ticker}:`, err.message);
        return null;
    }
}

// --- HLAVNÍ BĚH AGENTA ---

async function runAgent() {
    console.log("🚀 Spouštím AI Market Agenta...");
    
    const portfolio = await getPortfolio();
    const history = await getHistory();
    const results = [];

    // Zpracování ve shlucích (Batching)
    for (let i = 0; i < STOCKS.length; i += BATCH_SIZE) {
        const batch = STOCKS.slice(i, i + BATCH_SIZE);
        console.log(`📦 Analyzuji skupinu: ${batch.join(", ")}`);
        
        const batchPromises = batch.map(async (ticker) => {
            const data = await getStockData(ticker);
            if (data) {
                // Přidáme analýzu k datům
                data.analysis = await getStockAnalysis(ticker, data, portfolio[ticker], history[ticker]);
                return data;
            }
            return null;
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults.filter(r => r !== null));
    }

    if (results.length === 0) {
        console.error("❌ Žádná data nebyla stažena. Report nebude odeslán.");
        return;
    }

    const globalTopNews = results
        .flatMap(r => r.allRecentNews)
        .sort((a, b) => b.date - a.date)
        .slice(0, 10);

    // --- GENEROVÁNÍ E-MAILU ---
    let htmlContent = `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 850px; margin: auto; color: #1a1a1a; background: #f4f7f9; padding: 20px;">
            <h1 style="text-align: center; color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px;">Stock AI Intelligence Report</h1>
    `;

    results.forEach(d => {
        const isOwned = !!portfolio[d.ticker];
        const color = d.change >= 0 ? "#27ae60" : "#c0392b";
        const cardStyle = isOwned ? "border: 2px solid #3498db; background: #fff;" : "border: 1px solid #e1e4e8; background: #fafafa;";

        htmlContent += `
            <div style="${cardStyle} border-radius: 12px; padding: 20px; margin-bottom: 25px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #eee; padding-bottom: 10px; margin-bottom: 15px;">
                    <div>
                        <span style="font-size: 1.6em; font-weight: bold;">${d.ticker}</span>
                        ${isOwned ? '<span style="margin-left: 10px; background: #3498db; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.7em; vertical-align: middle;">PORTFOLIO</span>' : ''}
                    </div>
                    <div style="text-align: right;">
                        <div style="font-size: 1.3em; font-weight: bold; color: ${color};">${d.price.toFixed(2)} USD</div>
                        <div style="font-size: 0.9em; color: ${color};">${d.change >= 0 ? '▲' : '▼'} ${d.change.toFixed(2)}%</div>
                    </div>
                </div>
                
                <div style="background: #eef2f7; border-left: 5px solid #2c3e50; padding: 15px; margin-bottom: 15px; border-radius: 4px; line-height: 1.5;">
                    <strong style="color: #34495e;">🤖 AI Analýza & Doporučení:</strong><br>
                    ${d.analysis.replace(/\n/g, '<br>')}
                </div>

                <div style="font-size: 0.85em; color: #555;">
                    <strong style="color: #7f8c8d;">Zprávy k tickeru:</strong><br>
                    ${d.news.map(n => `<div style="margin-top: 5px;">• <a href="${n.link}" style="color: #3498db; text-decoration: none;">${n.title}</a> <span style="color: #999;">(${n.dateStr})</span></div>`).join('')}
                </div>
            </div>
        `;
    });

    htmlContent += `
            <div style="margin-top: 40px; padding: 20px; background: #2c3e50; border-radius: 12px; color: white;">
                <h2 style="color: #3498db; font-size: 1.1em; text-transform: uppercase;">🔥 Tržní puls (Nejnovější zprávy)</h2>
                ${globalTopNews.map(n => `<div style="margin-bottom: 8px; font-size: 0.85em; border-bottom: 1px solid #3e4f5f; padding-bottom: 4px;"><b>${n.ticker}</b>: ${n.title}</div>`).join('')}
            </div>
            <p style="font-size: 0.7em; text-align: center; color: #999; margin-top: 20px;">
                Generováno AI Agentem • ${new Date().toLocaleString('cs-CZ')}
            </p>
        </div>
    `;

    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: process.env.MAIL_USER, pass: process.env.GMAIL_PASS }
    });

    await transporter.sendMail({
        from: `"AI Market Expert" <${process.env.MAIL_USER}>`,
        to: EMAIL_RECIPIENT,
        subject: `AI Intelligence Report: ${results.length} aktiv analyzováno`,
        html: htmlContent
    });

    await saveHistory(results);
    console.log("✅ Report odeslán a historie aktualizována.");
}

runAgent().catch(console.error);