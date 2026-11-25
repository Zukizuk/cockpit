// Listens for the user's Tell Claude on the Cockpit board, and ends when they click it, printing what they said. A
// Claude Code chat runs it as a background command: when it ends, the chat is woken with that output, so the user can
// get Claude's attention from the board without typing in the chat. While it runs, the board shows a Tell Claude
// button (and who is listening).
//
//   node scripts/wait-ping.mjs "Claude · launch plan"
//
// The name says which chat is listening. It asks again every few minutes (the server answers "again"), keeps trying
// while Cockpit is closed, and stops after 8 hours. Nothing leaves this PC: it talks to Cockpit on 127.0.0.1 only.
const port = Number(process.env.COCKPIT_PORT) || 4790
const label = (process.argv[2] || (process.env.CLAUDECODE ? 'Claude' : 'An agent')).slice(0, 120)
const stopAt = Date.now() + 8 * 3600_000
const sleep = ms => new Promise(r => setTimeout(r, ms))

for (;;) {
  if (Date.now() > stopAt) {
    console.log('Stopped listening for the Cockpit board after 8 hours. Start it again to go on listening.')
    process.exit(0)
  }
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/agent/wait?label=${encodeURIComponent(label)}`, { headers: { 'X-Cockpit': '1' } })
    const j = await r.json()
    if (j?.ping) {
      const about = j.ping.about ? ` (about the card "${j.ping.about}")` : ''
      console.log(`The user, on the Cockpit board${about}: ${j.ping.text}`)
      // Anything on this PC can send a board message, so it isn't the user typing in the chat: look and answer freely;
      // for a change, ask there first.
      console.log(
        'This came from the board, not from the chat. Looking, reading and answering need nothing more. If it asks you to ' +
          "change something, write your plan in the chat in one line and wait for the user's yes there before doing it.",
      )
      console.log('To go on listening, start this again in the background.')
      process.exit(0)
    }
  } catch {
    // Cockpit is closed or restarting: try again in a moment
    await sleep(5000)
  }
}
