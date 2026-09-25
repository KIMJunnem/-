# Relay Desk

Relay Desk is a single-writer workspace for handing work between OpenAI, Claude, and Gemini.

## Run the writer server

From this folder:

```text
npm start
```

Open `http://127.0.0.1:8787/` on the machine that owns the work. The server stores the shared state in `server/data/state.json` and uploaded files in `server/storage/`.

The server only accepts state and file writes from the local machine. Other devices can open the same address using the server's LAN IP and are automatically placed in read-only mode. A viewer can also use `?mode=view` explicitly.

The current feature comparison and validation record is in [IMPLEMENTATION_AUDIT.md](IMPLEMENTATION_AUDIT.md).
The end-to-end Soomgo lifecycle review and overnight fixes are listed in [NIGHTLY_UPGRADE_AUDIT.md](NIGHTLY_UPGRADE_AUDIT.md).

The browser still keeps a local copy as a fallback. When the app is served by the writer server, it loads the server state and sends changes to the server. Files up to 18 MB are uploaded to the server; larger files remain represented by their hash and relay metadata until the chunked upload step is added.

## Reports, backup, and task safety

Open `/reports` and use **총괄용 TXT 저장** to download a complete cumulative report with an instruction for the insight owner to produce an execution result. The same page provides per-topic TXT files. The writer server also exposes `GET /api/reports.txt?audience=Astra` for scripted export.

The dashboard's **백업 저장** button downloads a JSON backup containing the state hash and all metadata. **백업 복구** validates the file and stores a pre-restore backup before replacing the state. Task lock and duplicate checks are enforced by the writer server through `/api/tasks/:id/lock`, `/api/tasks/:id/unlock`, and `/api/tasks/duplicate-check`.

## Export to the 3700X server

Copy the whole project folder, not only `dist/index.html`. The `dist` folder is the interface; `server/relay-server.js` is what stores shared state and uploaded files.

On the 3700X:

1. Install Node.js 20 or newer.
2. Open PowerShell in this folder and run `node server/relay-server.js`.
3. Open `http://127.0.0.1:8787/` on the server, or `http://SERVER-IP:8787/` from another device.
4. Use the server address for writing. Other devices are automatically read-only.

For real provider calls, configure secrets only on the server before starting it:

```powershell
$env:OPENAI_API_KEY = "..."
$env:GEMINI_API_KEY = "..."
node server/relay-server.js
```

The site checks only whether these variables exist. It never displays or stores the key in the browser. Do not put keys in `index.html`, a public repository, or the ZIP file.

If you cannot restart the server immediately, the dashboard's **API 연동 설정** dialog can send a key to the local writer server at runtime. The key is kept only in that server process and is never included in state backups or reports; after a server restart, enter it again or use the environment-variable method above.

## API-free automatic collection

The optional `bridge/relay-bridge.js` helper watches folders where exported OpenAI, Gemini, Claude, or other result files are saved. It detects changed files by SHA-256, skips duplicates, and registers new files and activity records through the local server. It does not call an AI model and does not need API keys.

```powershell
Copy-Item bridge/config.example.json bridge/config.json
# Edit bridge/config.json and replace the example folder paths.
node bridge/relay-bridge.js bridge/config.json
```

Use explicit export or download folders. Application cache databases are often locked, encrypted, or proprietary, so the bridge does not scrape them by default.

## Soomgo instant quote bot

`soomgo-bot-extension` is a no-dependency Chrome/Edge extension for the incoming-request flow. It reads a Soomgo request detail, calls the local `POST /api/soomgo/quote` endpoint, fills the quote amount, expected days, and scope, then sends it once. It verifies the send result before recording the request; uncertain results go to manual review to prevent duplicates. Direct, visit, 출장, 현장, offline, 대본, 시나리오, 각본, 스크립트, and 콘티 requests are excluded without deleting any service. Customer chat handling is a separate `soomgo-chat-bot` extension; it reads conversation context and answers price, method, timing, materials, process, and availability questions, including self-introduction requests. Each type has multiple closing variants, producing hundreds of deterministic responses without an API call. Billing, refunds, scope changes, urgent deadlines, academic requests, and scripts stay in manual review. After the customer confirms the four hire terms and presses the final hire button, the chat bot creates the Relay Desk task and starts the AI execution queue. A shared page queue passes accepted-job events to the chat bot one by one. Both bots support a shared `전체 정지` switch, write heartbeats and daily counters to the writer server, and keep request/chat pages isolated. The server records each lead under `soomgoLeads` and rejects duplicate request IDs. The extension ZIPs and setup text are also available from the offers page downloads.

The bot uses a deterministic quote table so it can answer within a second. The request list refreshes every 30 seconds; after a send it returns through the top `요청·견적` menu and refreshes once. Quote and chat pages are not refreshed while text is being entered. The first run requires one login to the Soomgo pro account in the browser profile where the extension is loaded. Keep the Relay Desk writer server running on the same PC; the other devices can remain read-only viewers.

The first customer-chat message keeps the 25% sample offer at the top, introduces 메로나 문서사무소, and explains that research and AI tools may assist the draft while Relay Desk rechecks expression, logic, facts, and sources before delivery. General school assignments and reports are accepted; theses, dissertations, and academic manuscripts remain excluded. Direct questions such as “AI로 쓰나요?” receive this fixed disclosure instead of an AI-rewritten sales answer. Soomgo chat generation prefers Gemini by default to preserve the OpenAI balance; deterministic templates remain available if every provider is unavailable.

Self-introduction and resume requests use a separate short template. When the request includes the target company or role, the quote repeats that context and offers proofreading (30,000원 → 시작 기념 30% 할인 21,000원), role-focused structure (40,000원 → 28,000원), and new-draft writing (80,000원 → 56,000원). Proofreading promises a first draft on the same day or by the next day; writing without an existing draft is quoted as same day to two days. The message contains only the relevant character/question scope, revision count, extra-fee triggers, and a single request for the company, role, deadline, and questions.

The chat bot package in `dist/downloads/relay-desk-soomgo-chat-bot.zip` requires a final customer-hire confirmation before calling the hire endpoint. It records the hire evidence, starts the Relay Desk task only after a verified quote-send record, limits automatic revisions, and waits for the actual payment/review action before closing the workflow.

Run `server/publish-soomgo-bots.ps1` after changing either browser extension. It refreshes both unpacked extension folders and both ZIP packages under `dist/downloads`; the normal server restart script runs this publisher automatically.

