import "dotenv/config";
import nodemailer from "nodemailer";
import Parser from "rss-parser";
import { Groq } from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const parser = new Parser();

// Tvůj seznam akcií
const STOCKS = ["MSFT", "NVDA", "ASML", "RIOT", "O", "MDB", "V", "AVGO", "IREN", "GOOG", "TSLA"]; 
const EMAIL_RECIPIENT = "jirijca@gmail.com";

async function getSentiment(ticker, news) {
    if (!news.length) return 0;
    try {
        const response = await groq.chat.completions.create({
            messages: [{
                role: "system",
                content: "Jsi finanční algoritmus. Analyzuj titulky a odpověz POUZE jedním číslem od -1.0 (velmi negativní) do 1.0 (velmi pozitivní). 0.0 je neutrální."
            }, {
                role: "user",
                content: `Ticker: ${ticker}. Zprávy: ${news.map(n => n.title).join(" | ")}`
            }],
            model: "llama-3.3-70b-versatile",
            temperature: 0,
        });
        return parseFloat(response.choices[0]?.message?.content) || 0;
    } catch (e) { return 0; }
}

async function getStockData(ticker) {
    try {
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`);
        const data = await res.json();
        const quote = data.chart.result[0].meta;
        
        // --- FILTRACE ZPRÁV (Max 48h staré) ---
        const feed = await parser.parseURL(`https://news.google.com/rss/search?q=${ticker}+stock+news&hl=en-US`);
        const fortyEightHoursAgo = new Date();
        fortyEightHoursAgo.setHours(fortyEightHoursAgo.getHours() - 48);

        const recentNews = feed.items
            .filter(item => new Date(item.pubDate) > fortyEightHoursAgo)
            .slice(0, 3) // Vezmeme max 3 nejnovější
            .map(n => ({
                title: n.title,
                date: new Date(n.pubDate).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })
            }));

        const sentiment = await getSentiment(ticker, recentNews);

        return {
            ticker,
            price: quote.regularMarketPrice,
            change: ((quote.regularMarketPrice - quote.previousClose) / quote.previousClose) * 100,
            news: recentNews,
            sentiment: sentiment
        };
    } catch (err) {
        console.error(`Chyba u ${ticker}:`, err.message);
        return null;
    }
}

async function runAgent() {
    console.log("🚀 Startuji hloubkovou analýzu...");
    const results = [];
    
    for (const ticker of STOCKS) {
        const data = await getStockData(ticker);
        if (data) {
            console.log(`✅ Zpracováno: ${ticker}`);
            results.push(data);
        }
    }

    // AI Shrnutí celkové situace
    const aiSummary = await groq.chat.completions.create({
        messages: [{
            role: "system",
            content: "Jsi elitní analytik. Podívej se na data a zprávy. Vyber 3 nejzajímavější události a shrň je česky v pár odrážkách."
        }, {
            role: "user",
            content: JSON.stringify(results.filter(r => r.news.length > 0))
        }],
        model: "llama-3.3-70b-versatile",
    }).then(res => res.choices[0]?.message?.content).catch(() => "Shrnutí nedostupné.");

    // --- FORMÁTOVÁNÍ DETAILNÍHO REPORTU ---
    const detailedList = results.map(d => {
        const icon = d.sentiment > 0.2 ? "🟢" : d.sentiment < -0.2 ? "🔴" : "⚪";
        const newsSection = d.news.length > 0 
            ? d.news.map(n => `   📰 [${n.date}] ${n.title}`).join("\n") 
            : "   (Žádné nové zprávy za 48h)";

        return `${icon} ${d.ticker.padEnd(5)} | ${d.price.toFixed(2)} | ${d.change.toFixed(2)}% | Senti: ${d.sentiment.toFixed(1)}\n${newsSection}`;
    }).join("\n\n" + "-".repeat(45) + "\n\n");

    const emailBody = `
=== DETAILNÍ AKCIOVÝ REPORT ===
(Filtrováno na zprávy < 48h)

${detailedList}

${"=".repeat(45)}
🤖 AI SHRNUTÍ TRHU:
${aiSummary}

Přeji úspěšné obchody!
    `;

    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: process.env.MAIL_USER, pass: process.env.GMAIL_PASS }
    });

    await transporter.sendMail({
        from: `"Stock AI Agent" <${process.env.MAIL_USER}>`,
        to: EMAIL_RECIPIENT,
        subject: `Market Report: ${new Date().toLocaleDateString()} (${STOCKS.length} akcií)`,
        text: emailBody
    });

    console.log("✅ Hotovo. Email odeslán.");
}

runAgent().catch(console.error);