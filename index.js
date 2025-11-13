import fetch from 'node-fetch';
import fs from 'fs';
import { encode, decode, RECURSION_DESIRED } from '@leichtgewicht/dns-packet';

async function resolveWithDoH(hostname, recordType = 'A') {
	const dnsQuery = encode({
		type: 'query',
		flags: RECURSION_DESIRED,
		questions: [{ type: recordType, name: hostname }]
	});

	const response = await fetch('https://dns.cloudflare.com/dns-query', {
		method: 'POST',
		headers: { 'Content-Type': 'application/dns-message' },
		body: dnsQuery
	});

	if (!response.ok) {
		throw new Error(`DoH request failed: ${response.status} ${response.statusText}`);
	}

	const responseBuffer = new Uint8Array(await response.arrayBuffer());
	const decoded = decode(responseBuffer);

	const answers = decoded.answers
		?.filter(a => a.type === recordType)
		?.map(a => a.data) || [];

	return answers;
}

async function postToResolvedHost(hostname, path, headers = {}, body = {}) {
	const ips = await resolveWithDoH(hostname, 'A');
	if (ips.length === 0) throw new Error(`No A record found for ${hostname}`);

	const ip = ips[0];
	console.log(`Resolved ${hostname} → ${ip}`);

	const url = `https://${ip}${path}`;
	console.log(`Posting to: ${url}`);

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Host': hostname,
			'Content-Type': 'application/json',
			'User-Agent': 'Mozilla/5.0',
			...headers
		},
		body: JSON.stringify(body)
	});

	const text = await response.text();
	console.log('Response:', text.slice(0, 200));
	return text;
}

function parsePrizeGroup(pz) {
	switch(pz) {
		case "1": return "First Prize";
		case "2": return "Second Prize";
		case "3": return "Third Prize";
		case "S": return "Starter Prize";
		case "C": return "Consolation Prize";
		default: return pz;
	}
}

// ============================
// AUTOMATIC LOOP + SAVE CSV
// ============================

const start = 1;
const end = 9999;
const batchSize = 5;
const outputFile = 'hasil_4d.csv';

// tulis header CSV jika belum ada
if (!fs.existsSync(outputFile)) {
	fs.writeFileSync(outputFile, "Number,Appearances,PrizeGroup,Date\n");
}

async function main() {
	for (let i = start; i <= end; i += batchSize) {
		const numbersInput = [];

		for (let j = i; j < i + batchSize && j <= end; j++) {
			numbersInput.push(j.toString().padStart(4, "0"));
		}

		console.log(`Checking batch: ${numbersInput.join(", ")}`);

		try {
			const text = await postToResolvedHost(
				'www.singaporepools.com.sg',
				'/_layouts/15/FourD/FourDCommon.aspx/Get4DNumberCheckResultsJSON',
				{
					"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
					"Accept": "application/json, text/javascript, */*; q=0.01",
					"X-Requested-With": "XMLHttpRequest",
					"Origin": "https://www.singaporepools.com.sg",
					"Referer": "https://www.singaporepools.com.sg/en/product/Pages/4d_cpwn.aspx",
				},
				{ numbers: numbersInput, checkCombinations: "false", sortTypeInteger: "1" }
			);

			const dParse = JSON.parse(text);
			const lParsed = JSON.parse(dParse.d);

			let csvRows = [];

			lParsed.forEach(item => {
				console.log("[Numbers]:", item.Number);
				console.log("[Appearances]:", item.NumberOfAppearances);

				item.Prizes.forEach(pz => {
					const date = new Date(parseInt(pz.DrawDate.match(/\d+/)[0], 10));
					const prizeGroup = parsePrizeGroup(pz.PrizeCode);
					const dateStr = date.toLocaleDateString("en-GB");

					console.log("[Prize Group]:", prizeGroup);
					console.log("[Date]:", dateStr);

					csvRows.push(`${item.Number},${item.NumberOfAppearances},"${prizeGroup}",${dateStr}`);
				});
				console.log("=================================");
			});

			if (csvRows.length > 0) {
				fs.appendFileSync(outputFile, csvRows.join("\n") + "\n");
				console.log(`✅ Saved ${csvRows.length} rows to ${outputFile}`);
			}

		} catch (err) {
			console.error("❌ Error on batch", numbersInput, err.message);
			await new Promise(r => setTimeout(r, 3000)); // tunggu sebelum lanjut
		}

		await new Promise(r => setTimeout(r, 1500)); // delay antar batch
	}
}

main();
