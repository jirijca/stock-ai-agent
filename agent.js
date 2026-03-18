import "dotenv/config";
import nodemailer from "nodemailer";
import { Groq } from "groq-sdk";
import fs from "fs/promises";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const STOCKS = ["GOOG", "MDB", "VKTX", "NVDA", "ONDS", "VUZI", "IPWR", "CPRX", "TAOP", "3CP.DE", "META", "ANGO", "ANNX", "MVIS", "AREC", "ASST", "NRDY", "ALAR", "TISC", "INDI", "NU", "IREN", "SOFI", "SOL", "CPNG", "V", "MDWD", "MVST", "CBAT", "JTAI", "SANA", "NVVE", "ATOS", "BTAI", "ARQ", "ENVX", "IRON", "GRYP", "NIO", "MRKR", "CAN", "QTBS", "HRMY", "ASBP", "RZLV", "OKLO", "GRAB", "AVGO", "RHM", "CRDO", "NUVB", "MSFT", "TTWO", "ASML", "RIOT", "O"];
const EMAIL_RECIPIENT = "jirijca@gmail.com";

async function runAgent() {
    const results = [];

    for (const ticker of STOCKS) {
        // V této verzi nebylo žádné Alpha Vantage, Groq psal analýzy z hlavy
        const completion = await groq.chat.completions.create({
            messages: [{ role: "user", content: `Analyzuj krátce akcii ${ticker}.` }],
            model: "llama-3.3-70b-versatile",
        });

        results.push({
            ticker: ticker,
            analysis: completion.choices[0].message.content
        });
    }

    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: process.env.MAIL_USER,
            pass: process.env.GMAIL_PASS
        }
    });

    await transporter.sendMail({
        from: process.env.MAIL_USER,
        to: EMAIL_RECIPIENT,
        subject: "Stock Analysis Report",
        text: JSON.stringify(results, null, 2)
    });
}

runAgent();