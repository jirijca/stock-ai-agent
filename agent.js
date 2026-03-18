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
const BATCH_SIZE = 4; 

// --- POMOCNÉ FUNKCE ---

async function getPortfolio() {
    try {
        const data = await fs.readFile("./portfolio.json", "utf-8");
        return JSON.parse(data);
    } catch (e) { return {}; }
}

async function getHistory() {
    try {
        const data = await fs.readFile("./history.json", "utf-8");
        return JSON.parse(data);
    } catch (e) { return {}; }
}

async function saveHistory(results) {
    try {
        const history = {};
        results.forEach(r => {
            history[r.ticker] = { price: r.price, date: new Date().toISOString() };
        });
        await fs.writeFile("./history.json", JSON.stringify(history, null, 2));
    } catch (e) { console.error("Chyba zápisu historie:", e.message); }
}

// --- ANALÝZA ---

async function getStockAnalysis(ticker, data, portfolioInfo, lastHistory) {
    if (!data.news?.length) return "⚠️ Žádné čerstvé zprávy. Akcie bez výrazných impulsů.";
    
    let pnlInfo = portfolioInfo 
        ? `POZOR: Máš v tom peníze! Držíš ${portfolioInfo.shares} ks, tvůj aktuální P/L je ${(((data.price - portfolioInfo.avgPrice) / portfolioInfo.avgPrice) * 100).toFixed(2)}%.` 
        : "Sledovaná pozice (zatím nevlastníš).";

    let histInfo = lastHistory 
        ? `Od včerejška se cena pohnula o ${(((data.price - lastHistory.price) / lastHistory.price) * 100).toFixed(2)}%.` 
        : "";

    try {
        const response = await groq.chat.completions.create({
            messages: [
                { role: "system", content: "Jsi elitní seniorní analytik z Wall Street. Piš nekompromisně, česky, max 3 úderné věty. Žádná vata, jdi k jádru věci a dopadu na portfolio. Na konec dej verdikt: [KOUPIT / DRŽET / REDUKOVAT / SLEDOVAT]." },
                { role: "user", content: `Ticker: ${ticker} | Cena: ${data.price} USD (${data.change.toFixed(2)}%) | ${histInfo} | ${pnlInfo} | Rozsah 52W: ${data.metrics.range} | Zprávy: ${data.news.map(n => n.title).join(" | ")}` }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.2,
        });
        return response.choices[0]?.message?.content || "Analýza nedostupná.";
    } catch (e) { return "AI analýza dočasně mimo provoz."; }
}

async function getStockData(ticker) {
    try {
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`);
        const json = await res.json();
        const meta = json.chart?.result?.[0]?.meta;
        if (!meta) return null;

        const price = meta.regularMarketPrice;
        const change = ((price - meta.previousClose) / meta.previousClose) * 100;
        const metrics = { range: `${meta.fiftyTwoWeekLow?.toFixed(2) || '?'} - ${meta.fiftyTwoWeekHigh?.toFixed(2) || '?'}` };

        const feed = await parser.parseURL(`https://news.google.com/rss/search?q=${ticker}+stock+news&hl=en-US`);
        const limitDate = new Date();
        limitDate.setHours(limitDate.getHours() - 48);

        const news = feed.items
            .filter(item => new Date(item.pubDate) > limitDate)
            .slice(0, 3)
            .map(n => ({ ticker, title: n.title, link: n.link, dateStr: new Date(n.pubDate).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) }));

        return { ticker, price, change, metrics, news };
    } catch (err) { return null; }
}

// --- HLAVNÍ BĚH ---

async function runAgent() {
    console.log("🚀 Spouštím vylepšený AGENT19...");
    const [portfolio, history] = await Promise.all([getPortfolio(), getHistory()]);
    const results = [];

    for (let i = 0; i < STOCKS.length; i += BATCH_SIZE) {
        const batch = STOCKS.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(batch.map(async (t) => {
            const data = await getStockData(t);
            if (data) data.analysis = await getStockAnalysis(t, data, portfolio[t], history[t]);
            return data;
        }));
        results.push(...batchResults.filter(r => r !== null));
    }

    if (!results.length) return console.error("❌ Žádná data stažena.");

    // --- VÝPOČET CELKOVÉHO P/L PORTFOLIA ---
    let totalValue = 0;
    let totalInvested = 0;
    results.forEach(d => {
        const pInfo = portfolio[d.ticker];
        if (pInfo) {
            totalValue += d.price * pInfo.shares;
            totalInvested += pInfo.avgPrice * pInfo.shares;
        }
    });

    const totalPnlCash = (totalValue - totalInvested).toFixed(2);
    const totalPnlPercent = totalInvested > 0 ? (((totalValue - totalInvested) / totalInvested) * 100).toFixed(2) : 0;
    const headerColor = totalPnlCash >= 0 ? "#27ae60" : "#c0392b";

    // --- GENEROVÁNÍ HTML ---
    let htmlBody = `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 800px; margin: auto; background: #f4f7f9; padding: 20px;">
            <div style="background: white; padding: 20px; border-radius: 12px; border-bottom: 5px solid ${headerColor}; margin-bottom: 30px; text-align: center; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <h1 style="margin: 0; color: #2c3e50; font-size: 1.5em;">Stock AI Intelligence Report</h1>
                <p style="margin: 10px 0 0; font-size: 1.2em; color: ${headerColor}; font-weight: bold;">
                    Celkový výsledek portfolia: ${totalPnlPercent}% (${totalPnlCash} USD)
                </p>
                <small style="color: #7f8c8d;">Aktuální tržní hodnota: ${totalValue.toFixed(2)} USD</small>
            </div>
    `;

    results.forEach(d => {
        const pInfo = portfolio[d.ticker];
        const isOwned = !!pInfo;
        const color = d.change >= 0 ? "#27ae60" : "#c0392b";
        
        let pnlBlock = "";
        if (isOwned) {
            const pnlP = (((d.price - pInfo.avgPrice) / pInfo.avgPrice) * 100).toFixed(2);
            const pnlC = ((d.price - pInfo.avgPrice) * pInfo.shares).toFixed(2);
            const pnlColor = pnlP >= 0 ? "#27ae60" : "#c0392b";
            pnlBlock = `
                <div style="margin-top: 10px; padding: 10px; border: 1px dashed #3498db; border-radius: 6px; background: #f0f7ff; font-size: 0.9em; display: flex; justify-content: space-between;">
                    <span><b>Pozice:</b> ${pInfo.shares} ks @ ${pInfo.avgPrice} USD</span>
                    <span style="color: ${pnlColor}; font-weight: bold;">P/L: ${pnlP}% (${pnlC} USD)</span>
                </div>`;
        }

        htmlBody += `
            <div style="background: white; padding: 15px; margin-bottom: 20px; border-radius: 12px; border-left: 6px solid ${isOwned ? '#3498db' : '#bdc3c7'}; box-shadow: 0 2px 5px rgba(0,0,0,0.05);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <b style="font-size: 1.3em; color: #2c3e50;">${d.ticker} ${isOwned ? '🔵' : ''}</b>
                    <div style="text-align: right;">
                        <b style="color: ${color}; font-size: 1.1em;">${d.price.toFixed(2)} USD</b><br>
                        <small style="color: ${color};">${d.change >= 0 ? '▲' : '▼'} ${d.change.toFixed(2)}%</small>
                    </div>
                </div>

                ${pnlBlock}

                <div style="background: #2c3e50; color: white; padding: 12px; border-radius: 6px; font-size: 0.95em; line-height: 1.4; margin-top: 15px; border-left: 4px solid #3498db;">
                    ${d.analysis.replace(/\n/g, '<br>')}
                </div>
                
                <div style="font-size: 0.8em; color: #666; margin-top: 12px;">
                    <strong style="color: #95a5a6;">Relevantní zprávy:</strong><br>
                    ${d.news.map(n => `• <a href="${n.link}" style="color: #3498db; text-decoration: none;">${n.title}</a>`).join('<br>')}
                </div>
            </div>`;
    });

    htmlBody += `<p style="text-align: center; color: #bdc3c7; font-size: 0.75em;">Generováno AI Agentem • ${new Date().toLocaleString('cs-CZ')}</p></div>`;

    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: process.env.MAIL_USER, pass: process.env.GMAIL_PASS } });
    await transporter.sendMail({ from: `"AI Market Expert" <${process.env.MAIL_USER}>`, to: EMAIL_RECIPIENT, subject: `Portfolio Report: ${totalPnlPercent}% | ${new Date().toLocaleDateString('cs-CZ')}`, html: htmlBody });

    await saveHistory(results);
    console.log("✅ Report odeslán.");
}

runAgent().catch(console.error);