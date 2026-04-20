import "dotenv/config";
import nodemailer from "nodemailer";
import { Groq } from "groq-sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs/promises";

// --- KONFIGURACE ---
const STOCKS = ["GOOG", "MDB", "VKTX", "NVDA", "ONDS", "VUZI", "IPWR", "CPRX", "TAOP", "3CP.DE", "META", "ANGO", "ANNX", "MVIS", "AREC", "ASST", "NRDY", "ALAR", "TISC", "INDI", "NU", "IREN", "SOFI", "SOL", "CPNG", "V", "MDWD", "MVST", "CBAT", "JTAI", "SANA", "NVVE", "ATOS", "BTAI", "ARQ", "ENVX", "IRON", "GRYP", "NIO", "MRKR", "CAN", "QTBS", "HRMY", "ASBP", "RZLV", "OKLO", "GRAB", "AVGO", "RHM", "CRDO", "NUVB", "MSFT", "TTWO", "ASML", "RIOT", "O"];
const EMAIL_RECIPIENT = "jirijca@gmail.com";

// Inicializace AI poskytovatelů
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// --- POMOCNÉ FUNKCE PRO DATA ---

async function fetchLivePrice(ticker) {
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
        const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
        const json = await res.json();
        const meta = json?.chart?.result?.[0]?.meta;
        return {
            price: meta?.regularMarketPrice || null,
            prevClose: meta?.regularMarketPreviousClose || null,
            currency: meta?.currency || "USD"
        };
    } catch (e) {
        console.error(`❌ Chyba ceny pro ${ticker}:`, e.message);
        return null;
    }
}

async function fetchTickerNews(ticker) {
    try {
        const url = `https://newsapi.org/v2/everything?q=${ticker}&sortBy=publishedAt&pageSize=5&apiKey=${process.env.NEWS_API_KEY}`;
        const res = await fetch(url);
        const json = await res.json();
        if (json.status !== "ok") throw new Error(json.message);
        return json.articles?.map(a => `- ${a.title}`).join("\n") || "Žádné aktuální zprávy.";
    } catch (e) {
        return "Nepodařilo se načíst zprávy přes NewsAPI.";
    }
}

// --- AI ANALÝZY (Wrapper funkce) ---

async function getGroqAnalysis(prompt) {
    try {
        const res = await groq.chat.completions.create({
            messages: [
                { role: "system", content: "Jsi stručný burzovní analytik. Piš česky." },
                { role: "user", content: prompt }
            ],
            model: "llama-3.3-70b-versatile"
        });
        return res.choices[0].message.content;
    } catch (e) { return `Groq Error: ${e.message}`; }
}

async function getGeminiAnalysis(prompt) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const res = await model.generateContent(prompt);
        return res.response.text();
    } catch (e) { return `Gemini Error: ${e.message}`; }
}

async function getClaudeAnalysis(prompt) {
    try {
        const res = await anthropic.messages.create({
            model: "claude-3-5-sonnet-20240620",
            max_tokens: 400,
            messages: [{ role: "user", content: prompt }]
        });
        return res.content[0].text;
    } catch (e) { return `Claude Error: ${e.message}`; }
}

// --- HLAVNÍ LOGIKA AGENTA ---

async function runAgent() {
    console.log("🚀 Startuji agenta...");
    const results = [];
    
    // 1. Sběr tržních dat
    for (const ticker of STOCKS) {
        const data = await fetchLivePrice(ticker);
        if (data && data.price && data.prevClose) {
            const changePct = ((data.price - data.prevClose) / data.prevClose) * 100;
            results.push({ ticker, ...data, changePct });
        }
        await new Promise(r => setTimeout(r, 150)); // Prevence rate-limitingu Yahoo
    }

    // 2. Filtrace: 3 největší propady a 3 největší nárůsty
    const sorted = [...results].sort((a, b) => a.changePct - b.changePct);
    const dips = sorted.filter(r => r.changePct < 0).slice(0, 3);
    const jumps = sorted.filter(r => r.changePct > 0).slice(-3).reverse();

    let aiSectionsHtml = "";

    // 3. Funkce pro zpracování analýz pro skupinu tickerů
    async function processGroup(group, title, color) {
        let html = `<h2 style="color:${color}; border-bottom: 2px solid ${color}; padding-bottom: 5px;">${title}</h2>`;
        if (group.length === 0) return html + "<p>Žádné výrazné pohyby.</p>";

        for (const item of group) {
            const news = await fetchTickerNews(item.ticker);
            const prompt = `Analyzuj pohyb akcie ${item.ticker} (${item.changePct.toFixed(2)}%). 
            Novinky: ${news}
            Úkol: Vysvětli příčinu pohybu a zhodnoť potenciál (buy-the-dip / exit). Max 3 věty, česky.`;

            // Paralelní volání všech 3 AI pro daný ticker
            const [resGroq, resGemini, resClaude] = await Promise.all([
                getGroqAnalysis(prompt),
                getGeminiAnalysis(prompt),
                getClaudeAnalysis(prompt)
            ]);

            html += `
                <div style="background:white; padding:15px; margin-bottom:15px; border-radius:8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
                    <h3 style="margin:0; color:#2980b9;">${item.ticker}: ${item.changePct.toFixed(2)}%</h3>
                    <div style="font-size:0.85em; margin-top:10px;">
                        <p><strong>Groq:</strong> ${resGroq}</p>
                        <p><strong>Gemini:</strong> ${resGemini}</p>
                        <p><strong>Claude:</strong> ${resClaude}</p>
                    </div>
                </div>`;
            console.log(`✅ Analyzováno: ${item.ticker}`);
        }
        return html;
    }

    aiSectionsHtml += await processGroup(dips, "📉 Největší propady (Dips)", "#c0392b");
    aiSectionsHtml += await processGroup(jumps, "📈 Největší nárůsty (Jumps)", "#27ae60");

    // 4. Odeslání emailu
    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: process.env.MAIL_USER, pass: process.env.GMAIL_PASS },
    });

    const dateStr = new Date().toLocaleDateString("cs-CZ");

    try {
        await transporter.sendMail({
            from: `"Wealth Agent" <${process.env.MAIL_USER}>`,
            to: EMAIL_RECIPIENT,
            subject: `🎯 Market Pulse ${dateStr} | Dips & Jumps`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 800px; margin: auto; background: #f4f6f8; padding: 20px; border-radius: 12px;">
                    <h1 style="text-align:center; color:#2c3e50;">Stock Insight Report</h1>
                    <p style="text-align:center; color:#7f8c8d;">Srovnávací analýza největších pohybů dne</p>
                    ${aiSectionsHtml}
                    <hr style="border:0; border-top:1px solid #ddd; margin:20px 0;">
                    <p style="font-size:0.7em; color:#999; text-align:center;">
                        Data: Yahoo Finance | Zprávy: NewsAPI | AI: Groq, Gemini, Claude
                    </p>
                </div>`
        });
        console.log("✉️ Report úspěšně odeslán.");
    } catch (err) {
        console.error("❌ Chyba při odesílání emailu:", err.message);
    }

    // 5. Uložení historie pro GitHub Actions
    await fs.writeFile("./history.json", JSON.stringify(results, null, 2));
    console.log("🏁 Hotovo.");
}

runAgent();