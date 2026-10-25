import type { FieldHelpMap } from "./types"

export const SETTINGS_HELP: FieldHelpMap = {
  // Settings → Assistant
  "llm.enabled": {
    title: "Turn on the assistant",
    what: "Turns the chat assistant on or off for everyone who signs in.",
    use: "When it's on, the assistant shows in the nav menu and as a button. It needs a saved Base URL and Model first. While it's off, Intake's Local AI receipt reading runs as Basic.",
  },
  "llm.hidden": {
    title: "Hide the assistant",
    what: "Takes the assistant out of the nav menu, the top-right button and the floating chat button, while it stays turned on.",
    use: "Features that use the AI model, like reading receipts in Intake, keep working. The chat page still opens if you type its address (/chat). Turn this off to get the entry points back.",
  },
  "llm.documents": {
    title: "Let the assistant read uploaded documents",
    what: "Gives the assistant a way to search and read the text of files you've uploaded.",
    use: "Needs Index uploaded documents turned on under Documents & search. When a file matches a question, its text is sent to the assistant's server. Health files stay out unless the option below is on.",
  },
  "llm.health-documents": {
    title: "Include health record documents",
    what: "Adds files that belong to a person (visits, conditions, medications and other health records) to what the assistant can read.",
    use: "Only works while Health is on under Features. It also decides whether Local AI may read Intake receipts that look like a person's. With a cloud server, this text leaves your network.",
  },
  "llm.base-url": {
    title: "Base URL",
    what: "The web address of the AI server the assistant talks to. Any OpenAI-compatible server works.",
    use: "In Docker, localhost means the container itself, so use the host's address. If the address is outside your network, a warning shows: questions, records and receipts would go to that provider.",
    values: [
      { label: "OpenAI", effect: "OpenAI's cloud. Needs an API key. Your data leaves your network." },
      { label: "Ollama", effect: "A server on your own machine, port 11434. No key needed. Nothing leaves your network." },
      { label: "LM Studio", effect: "A server on your own machine, port 1234. No key needed. Nothing leaves your network." },
      { label: "OpenRouter", effect: "A cloud service that reaches many models. Needs an API key. Your data leaves your network." },
    ],
  },
  "llm.model": {
    title: "Model",
    what: "The model's name exactly as the server lists it, such as gpt-4o-mini or llama3.1.",
    use: "Sent with every question. The model must support tool calling, because the assistant looks up your records through tools. Test connection checks this.",
  },
  "llm.api-key": {
    title: "API key",
    what: "The secret key from your AI provider. Local servers like Ollama usually don't need one.",
    use: "Stored encrypted and only sent to the server it was saved for. Moving the Base URL to a different server drops the saved key. Leave it blank to keep the saved key.",
  },
  "llm.temperature": {
    title: "Temperature",
    what: "How varied the answers are, from 0 to 2. Lower gives steadier, more literal answers. Higher gives looser ones.",
    use: "Leave it blank to use the server's default.",
  },
  "llm.max-tokens": {
    title: "Max tokens",
    what: "The longest reply the model may write in one go, counted in tokens. A token is roughly three quarters of a word.",
    use: "Leave it blank to use the server's default. Set it too low and answers get cut off.",
  },
  "llm.timeout": {
    title: "Time limit per question (seconds)",
    what: "How long the assistant may work on one question before it gives up. From 30 to 900 seconds, 180 if blank.",
    use: "Raise it for slow local models. A reply also stops if the server goes quiet for 60 seconds after it starts. Each model test gets the same limit.",
  },
  "llm.tool-rounds": {
    title: "Lookup rounds per question",
    what: "How many times the assistant may go back for more data before it has to answer. From 3 to 12, 8 if blank.",
    use: "Simple questions stop early either way. More rounds help follow-ups and multi-step questions but can make those answers slower.",
  },
  "llm.system-prompt": {
    title: "Extra instructions",
    what: "Your own instructions for the assistant, such as \"Keep answers short.\" Up to 4,000 characters.",
    use: "Added after the assistant's built-in instructions on every question, and in the model tests.",
  },
  "llm.extra-body": {
    title: "Extra request JSON",
    what: "Extra fields sent with every request to the AI server, written as a JSON object.",
    use: "For settings your server supports, like turning a model's thinking on (llama.cpp, vLLM) or OpenAI's reasoning_effort. It can't set model, messages, stream, tools or tool_choice. Leave it blank if unsure.",
  },

  // Settings → Mail server
  "mail.host": {
    title: "Server",
    what: "The address of your outgoing mail (SMTP) server, such as smtp.gmail.com.",
    use: "HomeCenter sends reminder emails and password reset links through it. Leave it blank to use the SMTP_HOST environment variable.",
  },
  "mail.port": {
    title: "Port",
    what: "The port on the mail server. 587 is the usual one. 465 is for TLS from the start.",
    use: "Blank uses SMTP_PORT, or 587. With Encryption on Automatic, port 465 turns TLS on.",
  },
  "mail.username": {
    title: "Username",
    what: "The account name for signing in to the mail server, usually your email address.",
    use: "Leave it blank for a relay that doesn't ask for a sign-in. Then no password is sent either.",
  },
  "mail.password": {
    title: "Password",
    what: "The password for that mail account. With Gmail or iCloud, use an app password, not your normal one.",
    use: "Stored encrypted. Leave it blank to keep the saved one. With no saved password, HomeCenter uses SMTP_PASS.",
  },
  "mail.secure": {
    title: "Encryption",
    what: "How the connection to the mail server is protected.",
    values: [
      { label: "Automatic (TLS on port 465)", effect: "TLS from the start on port 465. Other ports work like Never use TLS. If SMTP_SECURE is set, it decides instead." },
      { label: "Always use TLS", effect: "Encrypted from the first byte. Use it with port 465." },
      { label: "Never use TLS", effect: "Starts unencrypted. If the server offers STARTTLS, as most do on 587, the connection still switches to encryption." },
    ],
  },
  "mail.digest-hour": {
    title: "Digest hour",
    what: "The hour, 0 to 23, when daily and weekly reminder emails go out. It follows the server's clock.",
    use: "Weekly emails go out on Monday at this hour. People who get emails right away aren't affected. Blank uses DIGEST_HOUR, or 8.",
  },
  "mail.from": {
    title: "From address",
    what: "The sender name and address on HomeCenter's emails, like HomeCenter <you@gmail.com>.",
    use: "Many providers refuse mail unless this matches the account you signed in with. Blank uses MAIL_FROM, or HomeCenter <no-reply@homecenter.local>.",
  },
  "mail.public-url": {
    title: "Public address",
    what: "The address people type in their browser to reach HomeCenter, such as https://home.example.com.",
    use: "Links in emails, like password reset and reminder links, point here. Blank uses AUTH_URL.",
  },

  // Settings → Notifications (admin list)
  "recipients.receives": {
    title: "Who gets notifications",
    what: "Tick the accounts that should get reminders. A change saves right away.",
    use: "Ticked accounts get due reminders in the bell, and by email if they chose that. Unticking someone stops new ones. What's already in their list stays.",
  },

  // Settings → Notifications (everyone)
  "email.digest": {
    title: "Email notifications",
    what: "How often HomeCenter emails you the reminders waiting for you. Each email lists everything pending.",
    values: [
      { label: "Off", effect: "No email. Reminders still show in the bell." },
      { label: "As soon as possible", effect: "An email on every check that finds something pending. With a short check interval and repeat reminders, that is a lot of email." },
      { label: "Daily", effect: "One email a day at the digest hour, if anything is pending." },
      { label: "Weekly", effect: "One email on Monday at the digest hour, if anything is pending." },
    ],
  },
  "repeat.mode": {
    title: "Repeat reminders",
    what: "How often you are reminded about the same due item. A new due date always starts fresh.",
    use: "This applies to the bell, email and push. Checks run on the schedule an admin sets.",
    values: [
      { label: "Coming up, and on the due date", effect: "Two reminders per item: a heads-up when it enters its warning window, then one on the due date." },
      { label: "Only once", effect: "One reminder per item, then nothing until it has a new due date." },
      { label: "Every check until dismissed", effect: "A read item comes back on every check until you dismiss it. Very noisy unless checks are a day or more apart." },
    ],
  },

  // Settings → Notifications (admin: schedule and push)
  "notify.interval": {
    title: "Check every",
    what: "How many minutes pass between checks for due items. It sets when reminders are created, emailed and pushed.",
    use: "0 turns checks off. The lowest is 5. Blank uses NOTIFY_INTERVAL_MINUTES, or 360 (6 hours). People on Every check until dismissed get reminded on every check.",
  },
  "push.type": {
    title: "Service",
    what: "Where push messages go. HomeCenter sends one message per check, listing everything new.",
    values: [
      { label: "Discord webhook", effect: "Posts to a channel. Make the webhook in the channel's Integrations settings." },
      { label: "ntfy", effect: "Posts to an ntfy topic, on ntfy.sh or your own server." },
      { label: "Telegram bot", effect: "Messages a chat through a bot you made with BotFather." },
      { label: "Generic JSON webhook", effect: "Sends a JSON POST. Use it for Apprise API, Home Assistant and similar." },
    ],
  },
  "push.url": {
    title: "Webhook URL",
    what: "The address HomeCenter sends the message to. For ntfy, include the topic, like https://ntfy.sh/my-topic.",
    use: "Stored encrypted. Anyone with a Discord webhook URL can post to the channel, so keep it private. Leave it blank to keep the saved one.",
  },
  "push.token": {
    title: "Token",
    what: "For Telegram, the bot token from BotFather. For ntfy and JSON, an optional access token sent as a Bearer header.",
    use: "Stored encrypted. Leave it blank to keep the saved one.",
  },
  "push.chat-id": {
    title: "Chat ID",
    what: "The Telegram chat the bot messages. Message the bot once, then look up the ID with getUpdates.",
    use: "Groups have a negative number. Not a secret.",
  },

  // Settings → Users
  "users.name": {
    title: "Name",
    what: "The person's name as HomeCenter shows it.",
    use: "Shown in the Users list and the notification list. Reminder emails greet them by first name.",
  },
  "users.email": {
    title: "Email",
    what: "The address this person signs in with. Each account needs its own.",
    use: "After you create the account, HomeCenter shows a temporary password. They sign in with it once and must pick a new password. Reminder and password reset emails go to this address.",
  },
  "users.own-email": {
    title: "Email",
    what: "The address you sign in with. Reminder and password reset emails go here.",
    use: "Changing it asks for your current password. Use the new address next time you sign in.",
  },
  "users.role": {
    title: "Role",
    what: "What this person can do in HomeCenter. You can't change your own role.",
    values: [
      { label: "Admin", effect: "Everything a User can do, plus the admin settings: mail, assistant, documents, features, backups and users." },
      { label: "User", effect: "Adds and edits records and reminders. In Settings, sees only their own Notifications and Appearance." },
    ],
  },
  "users.current-password": {
    title: "Current password",
    what: "The password you sign in with now. HomeCenter asks for it before it changes your password or your sign-in email.",
  },
  "users.new-password": {
    title: "New password",
    what: "The password you'll sign in with from now on. At least 6 characters.",
    use: "Saving it signs you out on every device, this one included.",
  },
  "users.confirm-password": {
    title: "Confirm new password",
    what: "Type the new password again, to catch typos.",
  },

  // Settings → Documents & search
  "capture.parser": {
    title: "Receipt reading",
    what: "How Intake fills in the date, total and shop when you add a receipt.",
    use: "Applies to new items. Use Re-read on an item to read it again. Needs Index uploaded documents on, or there's no text to read.",
    values: [
      { label: "Off", effect: "Nothing is filled in, and Intake disappears from the menu." },
      { label: "Basic", effect: "A reader built into HomeCenter. Finds the date and total, sometimes the shop. Nothing leaves this server." },
      { label: "Local AI", effect: "Sends the receipt text to the assistant's server. If that server is outside your network, the text goes there." },
    ],
  },
  "documents.indexing": {
    title: "Index uploaded documents",
    what: "Reads the text out of uploaded files and keeps a search index on this server.",
    use: "The assistant's document search and Intake's receipt reading both need it. Turning it off stops new reading. Text already read stays until you use Clear extracted text.",
  },
  "documents.ocr": {
    title: "Read text from photos and scanned PDFs (OCR)",
    what: "Reads text from pictures, like a photo of a receipt or a scanned manual. Runs on this server.",
    use: "Uses a fair bit of CPU while new uploads are read. Turning it on goes back over files that came up empty before.",
  },
  "documents.semantic": {
    title: "Find documents by meaning, not just exact words",
    what: "Adds search by meaning, so \"boiler service\" can find a file that says \"furnace maintenance\".",
    use: "Runs the small AI model picked in the list below, on this server. Nothing leaves it. Intake also uses it to guess which asset a receipt belongs to. Off means keyword search only.",
  },

  // Settings → Assistant → Run model tests
  "modeltest.model": {
    title: "Model",
    what: "The model to test, on the server saved in Settings. Blank uses the saved model.",
    use: "Only for this test. Nothing here is saved.",
  },
  "modeltest.temperature": {
    title: "Temperature",
    what: "How varied the answers are, from 0 to 2. Blank uses the server's default.",
    use: "Only for this test. Nothing here is saved.",
  },
  "modeltest.rounds": {
    title: "Lookup rounds",
    what: "How many times the model may go back for more data before it has to answer, from 3 to 12. Blank uses the default.",
    use: "Only the Whole conversation tests use it.",
  },
  "modeltest.extra-body": {
    title: "Extra request JSON",
    what: "Extra fields sent with each test request, written as a JSON object. Reset to saved puts back what's in Settings.",
    values: [
      { label: "Thinking off", effect: "Asks the model to answer without thinking first (llama.cpp, vLLM). Faster replies." },
      { label: "Thinking on", effect: "Asks the model to think before it answers. Slower replies." },
      { label: "None", effect: "Sends no extra fields." },
    ],
  },
  "modeltest.stages": {
    title: "Which tests",
    what: "The three kinds of test. Untick one to skip it.",
    use: "Every test uses made-up data, not your records. It goes to the server saved in Settings.",
    values: [
      { label: "Picks the right lookup", effect: "Checks the model asks for the right data for a question." },
      { label: "Answers from the data", effect: "Checks the model answers correctly from the data it's given." },
      { label: "Whole conversation", effect: "Runs the full assistant from question to answer." },
    ],
  },
  "modeltest.topics": {
    title: "Topics",
    what: "Run only the tests about certain subjects. Pick All topics to run everything.",
  },
  "modeltest.repeat": {
    title: "Repeat",
    what: "How many times to run each test, from 1 to 5.",
    use: "Running a test more than once shows whether the model gives the same answer every time.",
  },
}
