import "dotenv/config";
import nodemailer from "nodemailer";
import Parser from "rss-parser";
import { Groq } from "groq-sdk";
import fs from "fs/promises";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const parser = new Parser();

const STOCKS = ["GOOG", "MDB", "VKTX", "NVDA", "ONDS", "VUZI", "IPWR", "CPRX", "TAOP", "3CP", "META", "ANGO", "ANNX", "MVIS", "AREC", "ASST", "NRDY", "ALAR", "TISC", "INDI", "NU", "IREN", "SOFI", "SOL", "CPNG", "V", "MDWD", "MVST", "CBAT", "JTAI", "SANA", "NVVE", "ATOS", "BTAI", "ARQ", "ENVX", "IRON", "GRYP", "NIO", "MRKR", "CAN", "QTBS", "HRMY", "ASBP", "RZLV", "OKLO", "GRAB", "AVGO", "RHM", "CRDO", "NUVB", "MSFT", "TTWO", "ASML", "RIOT", "O"];
const EMAIL_RECIPIENT = "jirijca@gmail.com";
const BATCH_SIZE = 2;
const delay = (ms) => new Promise(res => setTimeout(res, ms));

function getPositionContext(p, price) {
    if (!p?.shares) return null;

    const avg = p.avgPrice ?? p.vgPrice;
    if (!avg) return null;

    const pnlPct = ((price - avg) / avg) * 100;

    return {
        shares: p.shares,
        avgPrice: avg,
        pnlPct: pnlPct.toFixed(2)
    };
}

async function getUsdCzkRate() {
    try {
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/CZK=X`);
        const json = await res.json();
        return json.chart?.result?.[0]?.meta?.regularMarketPrice || 23.5;
    } catch {
        return 23.5;
    }
}

async function getStockData(ticker) {
    try {
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`);
        const json = await res.json();
        const meta = json.chart?.result?.[0]?.meta;

        if (!meta || !meta.previousClose) return null;

        const feed = await parser.parseURL(`https://news.google.com/rss/search?q=${ticker}+stock+news&hl=en-US`);

        return {
            ticker,
            price: meta.regularMarketPrice,
            change: ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100,
            news: feed.items.slice(0, 3).map(n => ({
                title: n.title,
                link: n.link
            }))
        };
    } catch {
        return null;
    }
}

function escapeHtml(str = "") {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

async function runAgent() {
    const portfolio = JSON.parse(await fs.readFile("./portfolio.json", "utf-8"));
    const usdCzkRate = await getUsdCzkRate();

    const results = [];

    for (let i = 0; i < STOCKS.length; i += BATCH_SIZE) {
        const batch = STOCKS.slice(i, i + BATCH_SIZE);

        const res = await Promise.all(batch.map(async (t) => {
            const data = await getStockData(t);
            if (!data) return null;

            const p = portfolio[t];
            const position = getPositionContext(p, data.price);

            const analysis = await groq.chat.completions.create({
                model: "llama-3.3-70b-versatile",
                messages: [
                    {
                        role: "system",
                        content: `
Jsi short-term hedge fund analytik.

HODNOTÍŠ:
- pouze aktuální situaci (dnes / poslední dny)

ZAKÁZÁNO:
- obecné fráze ("silná firma", "dobré fundamenty")
- historie firmy
- dlouhodobé kecy

POVINNÉ:
- konkrétní důvod pohybu (nebo přiznej že není)
- zohledni moji pozici
- buď stručný a tvrdý

VÝSTUP:
2 věty max.

Verdikt: [KOUPIT / DRŽET / REDUKOVAT]
`
                    },
                    {
                        role: "user",
                        content: `
Ticker: ${t}
Cena: ${data.price} USD
Denní změna: ${data.change.toFixed(2)}%

Moje pozice:
${position ? `
- Akcie: ${position.shares}
- Nákupní cena: ${position.avgPrice}
- PnL: ${position.pnlPct}%
` : `Nemám pozici`}
`
                    }
                ]
            });

            return {
                ...data,
                analysis: analysis.choices[0]?.message?.content || "N/A"
            };
        }));

        results.push(...res.filter(r => r !== null));
        await delay(2500);
    }

    // Makro (zatím basic)
    const marketOps = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
            {
                role: "system",
                content: `
Najdi 3 krátkodobé příležitosti.

ZAMĚŘ SE:
- největší pohyby
- možné reverze

NEPIŠ OBECNĚ.
`
            },
            {
                role: "user",
                content: results.map(r => `${r.ticker}: ${r.change.toFixed(2)}%`).join(", ")
            }
        ]
    });

    let totalValUsd = 0, totalInvUsd = 0;

    results.forEach(d => {
        const p = portfolio[d.ticker];
        if (p?.shares) {
            const avg = p.avgPrice ?? p.vgPrice;
            if (!avg) return;

            totalValUsd += d.price * p.shares;
            totalInvUsd += avg * p.shares;
        }
    });

    const pnlPct = totalInvUsd > 0
        ? (((totalValUsd - totalInvUsd) / totalInvUsd) * 100).toFixed(2)
        : "0.00";

    const color = (totalValUsd - totalInvUsd) >= 0 ? "#27ae60" : "#c0392b";

    let html = `<div style="font-family: Arial; background: #f4f7f9; padding: 20px;">
        <div style="background: white; padding: 25px; border-radius: 15px; border-bottom: 8px solid ${color}; text-align: center; margin-bottom: 20px;">
            <h1>Portfolio Intelligence (CZK)</h1>
            <b style="font-size: 2em;">${Math.round(totalValUsd * usdCzkRate).toLocaleString('cs-CZ')} CZK</b><br>
            <b style="color: ${color};">${pnlPct}%</b>
        </div>

        <div style="background: #fff9db; padding: 20px; border-radius: 15px;">
            <h3>🔥 Příležitosti</h3>
            ${escapeHtml(marketOps.choices[0]?.message?.content || "")}
        </div>`;

    results.forEach(d => {
        html += `
        <div style="background: white; padding: 15px; margin-top: 10px; border-radius: 10px;">
            <b>${d.ticker}</b> - ${d.price.toFixed(2)} USD (${d.change.toFixed(2)}%)
            <p>${escapeHtml(d.analysis)}</p>
        </div>`;
    });

    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: process.env.MAIL_USER,
            pass: process.env.GMAIL_PASS
        }
    });

    await transporter.sendMail({
        from: `"AI Agent" <${process.env.MAIL_USER}>`,
        to: EMAIL_RECIPIENT,
        subject: `Report: ${pnlPct}%`,
        html
    });

    await fs.writeFile("./history.json", JSON.stringify(results.map(r => ({
        t: r.ticker,
        p: r.price
    }))));
}

runAgent().catch(console.error);