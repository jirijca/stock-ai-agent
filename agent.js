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
                content: "Jsi finanční algoritmus. Analyzuj titulky a odpověz POUZE jedním číslem od -1.0 do 1.0. 0.0 je neutrální."
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
                ticker, // Přidáme ticker ke zprávě pro závěrečný výběr
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
            news: recentNews.slice(0, 3), // U akcie jen 3 zprávy
            allRecentNews: recentNews, // Schováme si všechny pro konec
            sentiment: sentiment
        };
    } catch (err) {
        return null;
    }
}

async function runAgent() {
    console.log("🚀 Generuji report: 3 zprávy u tickeru + 8 celkově na konci...");
    const results = [];
    for (const ticker of STOCKS) {
        const data = await getStockData(ticker);
        if (data) results.push(data);
    }

    // Shromáždíme úplně všechny zprávy a vybereme 8 nejnovějších napříč všemi akciemi
    const globalTopNews = results
        .flatMap(r => r.allRecentNews)
        .sort((a, b) => b.date - a.date)
        .slice(0, 8);

    const aiSummary = await groq.chat.completions.create({
        messages: [{
            role: "system",
            content: "Jsi analytik. Shrň nejdůležitější body z dat v češtině. Použij odrážky."
        }, {
            role: "user",
            content: JSON.stringify(results.map(r => ({ t: r.ticker, s: r.sentiment, p: r.price })))
        }],
        model: "llama-3.3-70b-versatile",
    }).then(res => res.choices[0]?.message?.content).catch(() => "Shrnutí nedostupné.");

    // --- HTML STYLING ---
    let htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 800px; margin: auto; color: #333; line-height: 1.5;">
            <h1 style="color: #2c3e50; border-bottom: 2px solid #eee; padding-bottom: 10px;">Market Intelligence</h1>
            
            <div style="background: #2c3e50; color: white; padding: 15px; border-radius: 8px; margin-bottom: 30px;">
                <h3 style="margin-top: 0; color: #f1c40f;">🤖 AI Shrnutí dne</h3>
                <div style="font-size: 0.95em;">${aiSummary.replace(/\n/g, '<br>')}</div>
            </div>
    `;

    // Sekce jednotlivých akcií
    results.forEach(d => {
        const color = d.sentiment > 0.2 ? "#27ae60" : d.sentiment < -0.2 ? "#c0392b" : "#7f8c8d";
        htmlContent += `
            <div style="margin-bottom: 20px; padding: 10px; border-bottom: 1px solid #eee;">
                <h3 style="margin: 0; color: ${color};">
                    ${d.ticker} — ${d.price.toFixed(2)} USD 
                    <span style="font-size: 0.8em; color: #555;">(${d.change >= 0 ? '+' : ''}${d.change.toFixed(2)}%)</span>
                </h3>
                <div style="font-size: 0.85em; margin-top: 5px;">
                    ${d.news.map(n => `• ${n.title}`).join('<br>')}
                    ${d.news.length === 0 ? '<i>Žádné nové zprávy (48h).</i>' : ''}
                </div>
            </div>
        `;
    });

    // --- SPECIÁLNÍ SEKCE NA KONCI: TOP 8 NEWS ---
    htmlContent += `
        <div style="margin-top: 40px; background: #f4f7f6; padding: 20px; border-radius: 8px;">
            <h2 style="margin-top: 0; color: #34495e; border-bottom: 1px solid #bdc3c7;">🔥 Nejnovější zprávy napříč trhem (Top 8)</h2>
            <ul style="padding-left: 20px;">
                ${globalTopNews.map(n => `
                    <li style="margin-bottom: 10px;">
                        <span style="color: #3498db; font-weight: bold;">[${n.ticker}]</span> 
                        <small style="color: #7f8c8d;">${n.dateStr}</small><br>
                        ${n.title}
                    </li>
                `).join('')}
            </ul>
        </div>
        <p style="font-size: 0.7em; text-align: center; color: #bdc3c7; margin-top: 30px;">
            Generováno v ${new Date().toLocaleString('cs-CZ')}
        </p>
    </div>`;

    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: process.env.MAIL_USER, pass: process.env.GMAIL_PASS }
    });

    await transporter.sendMail({
        from: `"Stock Professional" <${process.env.MAIL_USER}>`,
        to: EMAIL_RECIPIENT,
        subject: `Market Report: ${new Date().toLocaleDateString()}`,
        html: htmlContent
    });

    console.log("✅ Report odeslán s Top 8 novinkami na konci.");
}

runAgent().catch(console.error);