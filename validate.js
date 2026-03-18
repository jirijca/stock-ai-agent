import "dotenv/config";
import fs from "fs/promises";

async function validatePerformance() {
    console.log("📊 Spouštím hloubkovou validaci AI predikcí...");
    
    try {
        const data = await fs.readFile("./history.json", "utf-8");
        // Rozdělení podle řádků a sloučení do jednoho pole záznamů
        const history = data.trim().split("\n").map(line => JSON.parse(line)).flat();
        
        const currentPrices = {};
        const tickers = [...new Set(history.map(h => h.ticker))];

        console.log(`Načteno ${history.length} záznamů pro ${tickers.length} tickerů. Stahuji aktuální ceny...`);

        // Získáme aktuální ceny pro všechny tickery v historii
        for (let i = 0; i < tickers.length; i += 10) {
            const batch = tickers.slice(i, i + 10).join(",");
            const res = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${batch}`);
            const json = await res.json();
            json.quoteResponse.result.forEach(quote => {
                currentPrices[quote.symbol] = quote.regularMarketPrice;
            });
        }

        const stats = {
            KOUPIT: { count: 0, success: 0, avgGain: 0 },
            REDUKOVAT: { count: 0, success: 0, avgGain: 0 },
            DRŽET: { count: 0, success: 0, avgGain: 0 }
        };

        const detailedLog = [];

        history.forEach(entry => {
            const nowPrice = currentPrices[entry.ticker];
            if (!nowPrice) return;

            const diffPct = ((nowPrice - entry.price) / entry.price) * 100;
            const isSuccess = (entry.verdict === "KOUPIT" && diffPct > 0) || 
                              (entry.verdict === "REDUKOVAT" && diffPct < 0);

            stats[entry.verdict].count++;
            if (isSuccess) stats[entry.verdict].success++;
            stats[entry.verdict].avgGain += diffPct;

            detailedLog.push({
                ticker: entry.ticker,
                date: entry.date.split("T")[0],
                old: entry.price.toFixed(2),
                now: nowPrice.toFixed(2),
                diff: diffPct.toFixed(2) + "%",
                verdict: entry.verdict,
                result: isSuccess ? "✅" : "❌"
            });
        });

        console.table(detailedLog.slice(-20)); // Zobrazí posledních 20 obchodů

        console.log("\n--- FINÁLNÍ STATISTIKA ---");
        for (const [v, s] of Object.entries(stats)) {
            if (s.count > 0) {
                const rate = ((s.success / s.count) * 100).toFixed(1);
                const avg = (s.avgGain / s.count).toFixed(2);
                console.log(`${v}: Úspěšnost ${rate}% | Průměrný pohyb: ${avg}% (z ${s.count} predikcí)`);
            }
        }

    } catch (e) {
        console.error("Chyba při validaci:", e.message);
        console.log("Tip: Ujisti se, že history.json existuje a obsahuje data.");
    }
}

validatePerformance();