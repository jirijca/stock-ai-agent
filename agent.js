import "dotenv/config";
import nodemailer from "nodemailer";
import { Groq } from "groq-sdk";
import fs from "fs/promises";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const STOCKS = ["GOOG", "MDB", "VKTX", "NVDA", "ONDS", "VUZI", "IPWR", "CPRX", "TAOP", "3CP.DE", "META", "ANGO", "ANNX", "MVIS", "AREC", "ASST", "NRDY", "ALAR", "TISC", "INDI", "NU", "IREN", "SOFI", "SOL", "CPNG", "V", "MDWD", "MVST", "CBAT", "JTAI", "SANA", "NVVE", "ATOS", "BTAI", "ARQ", "ENVX", "IRON", "GRYP", "NIO", "MRKR", "CAN", "QTBS", "HRMY", "ASBP", "RZLV", "OKLO", "GRAB", "AVGO", "RHM", "CRDO", "NUVB", "MSFT", "TTWO", "ASML", "RIOT", "O"];
const EMAIL_RECIPIENT = "jirijca@gmail.com";
const USD_CZK = 24.1;

async function runAgent() {
    console.log("🚀 Startuji finální agenta...");
    
    // 1. NAČTENÍ PORTFOLIA PRO VÝPOČET SUMY
    let portfolio = {};
    try {
        const data = await fs.readFile("./portfolio.json", "utf-8");
        portfolio = JSON.parse(data);
    } catch (e) { console.error("Soubor portfolio.json nenalezen."); }

    const results = [];
    let totalValUsd = 0;
    let totalInvUsd = 0;

    // 2. VÝPOČET SUMY A ANALÝZA (S OCHRANOU)
    for (const ticker of STOCKS) {
        let analysis = "Analýza nedostupná (denní limit AI vyčerpán).";
        const p = portfolio[ticker] || { shares: 0, avgPrice: 0, vgPrice: 0 };
        const price = p.avgPrice || p.vgPrice || 0; // Fallback na nákupku, když nemáme API

        totalValUsd += (price * p.shares);
        totalInvUsd += ((p.avgPrice || p.vgPrice) * p.shares);

        try {
            const completion = await groq.chat.completions.create({
                messages: [
                    { role: "system", content: "Jsi stručný analytik. Piš česky. Body: SEKTOR, HLAVNÍ TREND, KATALYZÁTOR, VERDIKT (vše 1 věta)." },
                    { role: "user", content: `Ticker: ${ticker}` }
                ],
                model: "llama-3.3-70b-versatile",
            });
            analysis = completion.choices[0].message.content;
            console.log(`✅ ${ticker} analyzován.`);
        } catch (error) {
            console.log(`⚠️ ${ticker}: Limit tokenů dosažen.`);
        }
        
        results.push({ ticker, analysis });
        await new Promise(r => setTimeout(r, 200));
    }

    const pnlUsd = totalValUsd - totalInvUsd;
    const pnlPct = totalInvUsd > 0 ? ((pnlUsd / totalInvUsd) * 100).toFixed(2) : 0;
    const color = pnlUsd >= 0 ? "#27ae60" : "#c0392b";

    // 3. GENEROVÁNÍ REPORTU
    let htmlBody = `
        <div style="font-family: Arial, sans-serif; max-width: 800px; margin: auto;">
            <div style="background: white; padding: 20px; border-radius: 12px; border-top: 6px solid ${color}; text-align: center; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
                <h2 style="margin:0; color: #7f8c8d; font-size: 0.9em;">HODNOTA PORTFOLIA (ZÁKLADNÍ)</h2>
                <b style="font-size: 2em;">${Math.round(totalValUsd * USD_CZK).toLocaleString('cs-CZ')} CZK</b><br>
                <b style="color: ${color}; font-size: 1.2em;">${pnlPct}% (${Math.round(pnlUsd * USD_CZK).toLocaleString('cs-CZ')} CZK)</b>
                <p style="font-size: 0.8em; color: #999;">Poznámka: Výpočet vychází z nákupních cen v portfoliu (Offline mód).</p>
            </div>
            <h3 style="color: #2c3e50; margin-top: 25px;">Analýza aktiv</h3>
    `;

    results.forEach(r => {
        htmlBody += `
            <div style="background: #fff; border: 1px solid #ddd; padding: 15px; margin-bottom: 10px; border-radius: 8px;">
                <h4 style="margin: 0; color: #2980b9;">${r.ticker}</h4>
                <div style="font-size: 0.9em; margin-top: 8px; color: #333; line-height: 1.5;">
                    ${r.analysis.replace(/\n/g, '<br>')}
                </div>
            </div>`;
    });

    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: process.env.MAIL_USER, pass: process.env.GMAIL_PASS }
    });

    await transporter.sendMail({
        from: `"Wealth Agent" <${process.env.MAIL_USER}>`,
        to: EMAIL_RECIPIENT,
        subject: `Stock Insight | ${Math.round(totalValUsd * USD_CZK).toLocaleString('cs-CZ')} CZK`,
        html: htmlBody + "</div>"
    });

    console.log("🏁 Kompletní report odeslán.");
}

runAgent();