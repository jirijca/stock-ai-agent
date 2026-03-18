import "dotenv/config";
import nodemailer from "nodemailer";
import { Groq } from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const STOCKS = ["GOOG", "MDB", "VKTX", "NVDA", "ONDS", "VUZI", "IPWR", "CPRX", "TAOP", "3CP.DE", "META", "ANGO", "ANNX", "MVIS", "AREC", "ASST", "NRDY", "ALAR", "TISC", "INDI", "NU", "IREN", "SOFI", "SOL", "CPNG", "V", "MDWD", "MVST", "CBAT", "JTAI", "SANA", "NVVE", "ATOS", "BTAI", "ARQ", "ENVX", "IRON", "GRYP", "NIO", "MRKR", "CAN", "QTBS", "HRMY", "ASBP", "RZLV", "OKLO", "GRAB", "AVGO", "RHM", "CRDO", "NUVB", "MSFT", "TTWO", "ASML", "RIOT", "O"];
const EMAIL_RECIPIENT = "jirijca@gmail.com";

async function runAgent() {
    const results = [];
    console.log(`Zpracovávám ${STOCKS.length} tickerů bez externích API...`);

    for (const ticker of STOCKS) {
        try {
            const completion = await groq.chat.completions.create({
                messages: [
                    { 
                        role: "system", 
                        content: "Jsi elitní akciový analytik. Piš česky, stručně a věcně. Žádná omáčka." 
                    },
                    { 
                        role: "user", 
                        content: `Analyzuj ticker ${ticker}. Použij tento formát (každý bod max 1 věta):
                        - SEKTOR: (identifikuj odvětví)
                        - HLAVNÍ TREND: (co firmu aktuálně táhne)
                        - KATALYZÁTOR: (na co si dát pozor/co čekat)
                        - VERDIKT: (tvůj analytický pohled)` 
                    }
                ],
                model: "llama-3.3-70b-versatile",
                temperature: 0.2 // Nižší teplota pro větší přesnost
            });

            results.push({ ticker, analysis: completion.choices[0].message.content });
            console.log(`✅ ${ticker} hotovo.`);
            
            // Malý delay, abychom neprovokovali ani Request Per Minute (RPM) limit
            await new Promise(r => setTimeout(r, 500)); 
        } catch (error) {
            console.log(`❌ ${ticker} selhal.`);
            if (error.status === 429) break; // Pokud dojdou tokeny úplně, skonči a pošli co máš
        }
    }

    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: process.env.MAIL_USER, pass: process.env.GMAIL_PASS }
    });

    let htmlBody = `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 800px; margin: auto;">
            <h1 style="color: #2c3e50; border-bottom: 2px solid #34495e; padding-bottom: 10px;">AI Stock Insight (Offline Mode)</h1>
            <p style="color: #7f8c8d;"><i>Poznámka: Data vycházejí z interní databáze AI, nejsou v reálném čase.</i></p>
    `;

    results.forEach(r => {
        htmlBody += `
            <div style="background: #f8f9fa; padding: 15px; margin-bottom: 15px; border-radius: 8px; border-left: 4px solid #3498db;">
                <h3 style="margin: 0 0 10px 0; color: #2980b9;">${r.ticker}</h3>
                <div style="font-size: 0.92em; line-height: 1.6; color: #34495e;">
                    ${r.analysis.replace(/\n/g, '<br>')}
                </div>
            </div>
        `;
    });

    await transporter.sendMail({
        from: `"Wealth Agent" <${process.env.MAIL_USER}>`,
        to: EMAIL_RECIPIENT,
        subject: `Stock Analysis | ${results.length} Tickers`,
        html: htmlBody + "</div>"
    });

    console.log("🏁 Email odeslán.");
}

runAgent();