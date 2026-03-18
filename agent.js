import "dotenv/config";
import nodemailer from "nodemailer";
import { Groq } from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const STOCKS = ["GOOG", "MDB", "VKTX", "NVDA", "ONDS", "VUZI", "IPWR", "CPRX", "TAOP", "3CP.DE", "META", "ANGO", "ANNX", "MVIS", "AREC", "ASST", "NRDY", "ALAR", "TISC", "INDI", "NU", "IREN", "SOFI", "SOL", "CPNG", "V", "MDWD", "MVST", "CBAT", "JTAI", "SANA", "NVVE", "ATOS", "BTAI", "ARQ", "ENVX", "IRON", "GRYP", "NIO", "MRKR", "CAN", "QTBS", "HRMY", "ASBP", "RZLV", "OKLO", "GRAB", "AVGO", "RHM", "CRDO", "NUVB", "MSFT", "TTWO", "ASML", "RIOT", "O"];
const EMAIL_RECIPIENT = "jirijca@gmail.com";

async function runAgent() {
    const results = [];
    console.log(`Zpracovávám ${STOCKS.length} tickerů...`);

    for (const ticker of STOCKS) {
        let analysis = "Analýza momentálně nedostupná (vyčerpán denní limit AI).";
        try {
            // Zkusíme zavolat Groq
            const completion = await groq.chat.completions.create({
                messages: [
                    { role: "system", content: "Jsi stručný analytik. Piš česky. Body: SEKTOR, TREND, KATALYZÁTOR, VERDIKT." },
                    { role: "user", content: `Ticker: ${ticker}` }
                ],
                model: "llama-3.3-70b-versatile",
            });
            analysis = completion.choices[0].message.content;
            console.log(`✅ ${ticker} zanalyzován.`);
        } catch (error) {
            console.log(`⚠️ ${ticker}: Použit default (limit tokenů).`);
            // Pokud je to limit, nebudeme to zkoušet 54x a "spamovat" konzoli chybami
            if (error.status === 429 && results.length > 5) {
                console.log("🛑 Limit potvrzen, zbytek bude bez analýzy.");
            }
        }
        
        results.push({ ticker, analysis });
        // Krátký delay pro stabilitu
        await new Promise(r => setTimeout(r, 200));
    }

    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: process.env.MAIL_USER, pass: process.env.GMAIL_PASS }
    });

    let htmlBody = `
        <div style="font-family: Arial; max-width: 800px; margin: auto;">
            <h1 style="color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px;">Stock Insight Report</h1>
            <p style="background: #eee; padding: 10px; border-radius: 5px;">
                <b>Stav:</b> ${results.filter(r => !r.analysis.includes("nedostupná")).length} / ${STOCKS.length} tickerů zanalyzováno.
            </p>
    `;

    results.forEach(r => {
        htmlBody += `
            <div style="background: #fff; border: 1px solid #ddd; padding: 15px; margin-bottom: 10px; border-radius: 8px;">
                <h3 style="margin: 0; color: #2980b9;">${r.ticker}</h3>
                <div style="font-size: 0.9em; margin-top: 10px; color: #333;">
                    ${r.analysis.replace(/\n/g, '<br>')}
                </div>
            </div>`;
    });

    await transporter.sendMail({
        from: `"Wealth Agent" <${process.env.MAIL_USER}>`,
        to: EMAIL_RECIPIENT,
        subject: `Stock Insights | ${STOCKS.length} akcií`,
        html: htmlBody + "</div>"
    });

    console.log("🏁 Email odeslán.");
}

runAgent();