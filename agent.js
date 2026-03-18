import "dotenv/config";
import nodemailer from "nodemailer";
import { Groq } from "groq-sdk";
import fs from "fs/promises";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Testovací režim: pouze jeden ticker
const STOCKS = ["NVDA"]; 
const EMAIL_RECIPIENT = "jirijca@gmail.com";

async function getStockData(ticker) {
    try {
        // Cena a změna z Alpha Vantage
        const priceRes = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${process.env.ALPHA_VANTAGE_API_KEY}`);
        const priceJson = await priceRes.json();
        const d = priceJson["Global Quote"];
        
        if (!d || !d["05. price"]) {
            console.error(`❌ Alpha Vantage: Žádná data pro ${ticker}. Zkontroluj API klíč nebo limit.`);
            return null;
        }

        // Aktuální zprávy z NewsAPI
        const newsRes = await fetch(`https://newsapi.org/v2/everything?q=${ticker}+stock&pageSize=3&sortBy=publishedAt&apiKey=${process.env.NEWS_API_KEY}`);
        const newsJson = await newsRes.json();
        const news = newsJson.articles?.map(a => a.title).join(" | ") || "Žádné aktuální zprávy.";

        return {
            ticker: ticker.toUpperCase(),
            price: parseFloat(d["05. price"]),
            change: parseFloat(d["10. change percent"].replace('%', '')),
            news
        };
    } catch (e) {
        console.error(`❌ Chyba při stahování dat ${ticker}:`, e.message);
        return null;
    }
}

async function runAgent() {
    console.log("🚀 Spouštím testovací analýzu...");
    
    let portfolio = {};
    try {
        const portData = await fs.readFile("./portfolio.json", "utf-8");
        portfolio = JSON.parse(portData);
    } catch (e) { console.log("ℹ️ portfolio.json nenalezen, pokračuji bez něj."); }

    const results = [];
    for (const t of STOCKS) {
        const data = await getStockData(t);
        if (data) {
            const analysis = await groq.chat.completions.create({
                messages: [
                    { role: "system", content: "Jsi seniorní investiční analytik. Piš česky, stručně a k věci. Verdikt: [KOUPIT/DRŽET/REDUKOVAT] + 1 věta zdůvodnění." },
                    { role: "user", content: `Ticker: ${data.ticker}, Cena: ${data.price} USD, Změna: ${data.change}%, Zprávy: ${data.news}` }
                ],
                model: "llama-3.3-70b-versatile"
            });

            const content = analysis.choices[0].message.content;
            const cleanVerdict = content.includes("KOUPIT") ? "KOUPIT" : content.includes("REDUKOVAT") ? "REDUKOVAT" : "DRŽET";
            
            results.push({ ...data, analysis: content, cleanVerdict });
            console.log(`✅ Analýza ${t} dokončena.`);
        }
    }

    if (results.length === 0) return console.log("‼️ Žádná data k odeslání.");

    // Zápis do historie pro validate.js
    const logEntries = results.map(r => ({
        ticker: r.ticker,
        price: r.price,
        verdict: r.cleanVerdict,
        date: new Date().toISOString()
    }));
    await fs.appendFile("./history.json", JSON.stringify(logEntries) + "\n");

    // Sestavení a odeslání emailu
    const html = results.map(r => `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
            <h2>${r.ticker}: ${r.price} USD (${r.change}%)</h2>
            <div style="background: #2c3e50; color: white; padding: 15px; border-radius: 5px;">
                ${r.analysis.replace(/\n/g, '<br>')}
            </div>
        </div>`).join("");

    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: process.env.MAIL_USER, pass: process.env.GMAIL_PASS }
    });

    await transporter.sendMail({
        from: `"AI Agent" <${process.env.MAIL_USER}>`,
        to: EMAIL_RECIPIENT,
        subject: `Test Report: ${STOCKS[0]}`,
        html
    });

    console.log("🏁 Test úspěšně dokončen, email odeslán.");
}

runAgent().catch(console.error);