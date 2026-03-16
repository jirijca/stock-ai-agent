console.log("--- START AGENTA (HYBRIDNÍ VERZE) ---");
import "dotenv/config";
import nodemailer from "nodemailer";
import Parser from "rss-parser";

const parser = new Parser();
const STOCKS = ["MSFT", "NVDA", "ASML", "RIOT", "O", "MDB", "CBAT", "V", "MDWD", "CPRX", "IPWR", "ANGO", "ARQ", "NRDY", "ANNX", "MVIS", "AREC", "VKTX", "SANA", "ASST", "ALAR", "AVGO", "JTAI", "NVVE", "INDI", "BTAI", "IREN", "ATOS", "ENVX", "ONDS", "GRYP", "IRON", "GRAB", "MRKR", "NB", "CAN", "ASBP", "HRMY", "QBTS", "OKLO", "RZLV", "GOOGC", "CRDO", "NUVB", "RHM", "TTWO", "MSFT", "AVAV", "PBF"];
const EMAIL_RECIPIENT = "jirijca@gmail.com";

async function getStockPrice(ticker) {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`);
    const data = await res.json();
    const quote = data.chart.result[0].meta;
    return {
      price: quote.regularMarketPrice,
      change: ((quote.regularMarketPrice - quote.previousClose) / quote.previousClose) * 100
    };
  } catch (err) {
    return { price: 0, change: 0 };
  }
}

async function getHuggingFaceAnalysis(ticker, news) {
  if (!news.length) return "Žádné zprávy k analýze.";
  
  try {
    // ZMĚNA: Použití Llama-3, která má na routeru nejlepší podporu
    const url = "https://api-inference.huggingface.co/models/meta-llama/Meta-Llama-3-8B-Instruct";
    
    const response = await fetch(url, {
      headers: { 
        Authorization: `Bearer ${process.env.HF_TOKEN}`, 
        "Content-Type": "application/json" 
      },
      method: "POST",
      body: JSON.stringify({
        inputs: `<|begin_of_text|><|start_header_id|>user<|end_header_id|>\n\nJsi finanční analytik. Shrň tyto zprávy pro ${ticker} dvěma českými větami: ${news.join(". ")}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n`,
        parameters: { max_new_tokens: 150 }
      }),
    });

    const text = await response.text(); // Nejdřív načteme jako text, abychom viděli chybu
    
    if (text.includes("Not Found")) {
      console.log("   ⚠️ Model na této adrese nenalezen, vracím základní zprávy.");
      return "AI analýza se připravuje.";
    }

    const result = JSON.parse(text);

    if (result.error && result.error.includes("currently loading")) {
      return "AI model se načítá, zkuste to za chvíli.";
    }

    if (Array.isArray(result) && result[0]?.generated_text) {
      // Očištění odpovědi od systémových značek
      const output = result[0].generated_text;
      return output.split("<|start_header_id|>assistant<|end_header_id|>")[1]?.trim() || output;
    }
    
    return "AI analýza nedostupná.";
  } catch (err) {
    console.log("   ⚠️ Chyba:", err.message);
    return "Chyba při volání AI.";
  }
}

async function checkStocks() {
  console.log("1️⃣ Prověřuji akcie a zprávy...");
  let alerts = [];

  for (const ticker of STOCKS) {
    const { price, change } = await getStockPrice(ticker);
    const feed = await parser.parseURL(`https://news.google.com/rss/search?q=${ticker}+stock+news&hl=en-US`);
    const news = feed.items.slice(0, 3).map(n => n.title);
    
    console.log(`🔍 ${ticker}: ${price} (${change.toFixed(2)}%)`);

    // --- ŘEŠENÍ 1: Přímé titulky (Vždy spolehlivé) ---
    const newsList = news.map(title => `- ${title}`).join("\n");
    
    // --- ŘEŠENÍ 2: AI analýza ---
    const aiSummary = await getHuggingFaceAnalysis(ticker, news);

    alerts.push(
      `📌 ${ticker} | Cena: ${price} | Změna: ${change.toFixed(2)}%\n` +
      `📰 Zprávy:\n${newsList}\n` +
      `🤖 AI Shrnutí: ${aiSummary}\n` +
      `---------------------------------`
    );
  }

  if (alerts.length > 0) {
    console.log("2️⃣ Posílám email...");
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.MAIL_USER, pass: process.env.GMAIL_PASS }
    });

    await transporter.sendMail({
      from: `"Stock Agent" <${process.env.MAIL_USER}>`,
      to: EMAIL_RECIPIENT,
      subject: `Stock Report: MSFT & NVDA`,
      text: alerts.join("\n\n")
    });
    console.log("✅ Hotovo.");
  }
}

checkStocks().catch(console.error);