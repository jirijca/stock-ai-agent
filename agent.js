import "dotenv/config";
import nodemailer from "nodemailer";
import Parser from "rss-parser";
import { Groq } from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const parser = new Parser();

const STOCKS = ["MSFT", "NVDA", "ASML", "RIOT", "O", "MDB", "V", "AVGO", "IREN", "GOOG", "TSLA"]; 
const EMAIL_RECIPIENT = "jirijca@gmail.com";

async function getSentiment(ticker, news) {
    if (!news.length) return 0;
    try {
        const response = await groq.chat.completions.create({
            messages: [{
                role: "system",
                content: "Jsi finanční analytik. Na základě titulků urči sentiment od -1.0 do 1.0. Odpověz POUZE číslem."
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
        
        const feed = await parser.parseURL(`https://news.google.com/rss/search?q=${ticker}+stock+news&hl=en-US`);
        const fortyEightHoursAgo = new Date();
        fortyEightHoursAgo.setHours(fortyEightHoursAgo.getHours() - 48);

        const recentNews = feed.items
            .filter(item => new Date(item.pubDate) > fortyEightHoursAgo)
            .map(n => ({
                ticker,
                title: n.title,
                date: new Date(n.pubDate),
                dateStr: new Date(n.pubDate).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }),
                link: n.link
            }));

        const sentiment = await getSentiment(ticker, recentNews.slice(0, 3));

        return {
            ticker,
            price: quote.regularMarketPrice,
            change: ((quote.regularMarketPrice - quote.previousClose) / quote.previousClose) * 100,
            news: recentNews.slice(0, 3), // 3 zprávy u tickeru
            allRecentNews: recentNews,
            sentiment: sentiment
        };
    } catch (err) { return null; }
}

async function runAgent() {
    console.log("🚀 Spouštím vylepšenou analýzu...");
    const results = [];
    for (const ticker of STOCKS) {
        const data = await getStockData(ticker);
        if (data) results.push(data);
    }

    // --- GROQ ANALÝZA: Vybere jen to nejdůležitější ---
    const interestingStocks = results.filter(r => Math.abs(r.change) > 2 || Math.abs(r.sentiment) > 0.4);
    
    let aiInsights = "";
    if (interestingStocks.length > 0) {
        aiInsights = await groq.chat.completions.create({
            messages: [{
                role: "system",
                content: "Jsi zkušený investor. Podívej se na vybrané akcie a napiš ke 2-3 nejzajímavějším krátký komentář v češtině (proč rostou/klesají a co říká sentiment). Buď konkrétní."
            }, {
                role: "user",
                content: JSON.stringify(interestingStocks)
            }],
            model: "llama-3.3-70b-versatile",
        }).then(res => res.choices[0]?.message?.content).catch(() => "");
    }

    // Všechny zprávy pro závěrečnou sekci (Top 8)
    const globalTopNews = results
        .flatMap(r => r.allRecentNews)
        .sort((a, b) => b.date - a.date)
        .slice(0, 8);

    // --- HTML REPORT ---
    let htmlContent = `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 750px; margin: auto; color: #1a1a1a;">
            <h1 style="color: #000; border-bottom: 3px solid #f1c40f; padding-bottom: 5px;">Market Intelligence Report</h1>
            
            ${aiInsights ? `
            <div style="background: #fffbe6; border: 1px solid #ffe58f; padding: 15px; border-radius: 4px; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #856404;">💡 AI Insights (Komentář k pohybu)</h3>
                <div style="line-height: 1.5; font-size: 0.95em;">${aiInsights.replace(/\n/g, '<br>')}</div>
            </div>` : ''}

            <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
                <tr style="background: #f8f9fa; border-bottom: 2px solid #dee2e6;">
                    <th style="padding: 10px; text-align: left;">Ticker</th>
                    <th style="padding: 10px; text-align: right;">Cena</th>
                    <th style="padding: 10px; text-align: right;">Změna</th>
                    <th style="padding: 10px; text-align: center;">Senti</th>
                </tr>
    `;

    results.forEach(d => {
        const sentiColor = d.sentiment > 0.2 ? "#27ae60" : d.sentiment < -0.2 ? "#c0392b" : "#666";
        const changeColor = d.change >= 0 ? "#27ae60" : "#c0392b";
        
        htmlContent += `
            <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 10px; font-weight: bold;">${d.ticker}</td>
                <td style="padding: 10px; text-align: right;">${d.price.toFixed(2)}</td>
                <td style="padding: 10px; text-align: right; color: ${changeColor}; font-weight: bold;">${d.change >= 0 ? '+' : ''}${d.change.toFixed(2)}%</td>
                <td style="padding: 10px; text-align: center; color: ${sentiColor}; font-weight: bold;">${d.sentiment.toFixed(1)}</td>
            </tr>
            <tr>
                <td colspan="4" style="padding: 0 10px 15px 20px; font-size: 0.82em; color: #555;">
                    ${d.news.map(n => `<div style="margin-bottom: 3px;">• <span style="color: #999;">[${n.dateStr}]</span> ${n.title}</div>`).join('')}
                    ${d.news.length === 0 ? '<div style="color: #bbb;">(Žádné nové zprávy)</div>' : ''}
                </td>
            </tr>
        `;
    });

    htmlContent += `
            </table>

            <div style="margin-top: 40px; background: #fdfdfd; border: 1px solid #eee; padding: 20px;">
                <h2 style="margin-top: 0; font-size: 1.2em; color: #2c3e50;">🔥 Nejnovější zprávy napříč trhem (Top 8)</h2>
                <div style="font-size: 0.85em;">
                    ${globalTopNews.map(n => `
                        <div style="margin-bottom: 10px; padding-bottom: 5px; border-bottom: 1px solid #f9f9f9;">
                            <b style="color: #3498db;">${n.ticker}</b> <span style="color: #999;">[${n.dateStr}]</span><br>
                            ${n.title}
                        </div>
                    `).join('')}
                </div>
            </div>
            <p style="font-size: 0.75em; text-align: center; color: #aaa; margin-top: 30px;">
                Filtrováno < 48h. Generováno v ${new Date().toLocaleString('cs-CZ')}
            </p>
        </div>
    `;

    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: process.env.MAIL_USER, pass: process.env.GMAIL_PASS }
    });

    await transporter.sendMail({
        from: `"Stock AI Agent" <${process.env.MAIL_USER}>`,
        to: EMAIL_RECIPIENT,
        subject: `Market Report: ${new Date().toLocaleDateString()}`,
        html: htmlContent
    });

    console.log("✅ Report odeslán.");
}

runAgent().catch(console.error);