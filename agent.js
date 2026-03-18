import "dotenv/config";
import nodemailer from "nodemailer";
import { Groq } from "groq-sdk";
import fs from "fs/promises";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const STOCKS = ["GOOG", "MDB", "VKTX", "NVDA", "ONDS", "VUZI", "IPWR", "CPRX", "TAOP", "3CP.DE", "META", "ANGO", "ANNX", "MVIS", "AREC", "ASST", "NRDY", "ALAR", "TISC", "INDI", "NU", "IREN", "SOFI", "SOL", "CPNG", "V", "MDWD", "MVST", "CBAT", "JTAI", "SANA", "NVVE", "ATOS", "BTAI", "ARQ", "ENVX", "IRON", "GRYP", "NIO", "MRKR", "CAN", "QTBS", "HRMY", "ASBP", "RZLV", "OKLO", "GRAB", "AVGO", "RHM", "CRDO", "NUVB", "MSFT", "TTWO", "ASML", "RIOT", "O"];
const EMAIL_RECIPIENT = "jirijca@gmail.com";

async function getStockData(ticker) {
    try {
        const response = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${process.env.ALPHA_VANTAGE_API_KEY}`);
        const data = await response.json();
        const quote = data["Global Quote"];
        if (!quote) return null;
        return {
            ticker: ticker,
            price: parseFloat(quote["05. price"]),
            change: quote["10. change percent"]
        };
    } catch (error) {
        return null;
    }
}

async function runAgent() {
    let portfolio = {};
    try {
        const data = await fs.readFile("./portfolio.json", "utf-8");
        portfolio = JSON.parse(data);
    } catch (e) {}

    const results = [];
    for (const ticker of STOCKS) {
        const data = await getStockData(ticker);
        if (data) {
            const completion = await groq.chat.completions.create({
                messages: [{ role: "user", content: `Analyzuj krátce akcii ${ticker} při ceně ${data.price}.` }],
                model: "llama-3.3-70b-versatile",
            });
            results.push({ ...data, analysis: completion.choices[0].message.content });
        }
    }

    const usdToCzk = 24.1;
    let totalUsd = 0;
    results.forEach(r => {
        const p = portfolio[r.ticker];
        if (p) totalUsd += r.price * p.shares;
    });

    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: process.env.MAIL_USER, pass: process.env.GMAIL_PASS }
    });

    await transporter.sendMail({
        from: process.env.MAIL_USER,
        to: EMAIL_RECIPIENT,
        subject: `Portfolio: ${Math.round(totalUsd * usdToCzk)} CZK`,
        text: JSON.stringify(results, null, 2)
    });
}

runAgent();