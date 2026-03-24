# Lead Qualifier Frontend

Standalone Vue 3 + Vite frontend for a Bonsai lead qualifier assistant example. 

This app was vibe-coded with Codex.

## What It Does

- Captures a lead's `name`, `work email`, and `company`.
- Persists those lead details in browser local storage.
- Connects to a Bonsai WebSocket runtime.
- Starts a conversation on a configured entry stage.
- Immediately runs `client_provide_user_data`.
- Shows a streaming text chat UI for the lead qualifier assistant.

This app does **not** modify Bonsai. It only connects to an existing Bonsai project and runs as a frontend. 

This application will also display "Director Thoughts" and "Director Red Flags" (if they are brought up) to visualise the Director pattern 

## Configuration

All runtime configuration is loaded from env variables.

Required variables:

- `VITE_BONSAI_API_BASE_URL` - the URL to your Bonsai instance
- `VITE_BONSAI_PROJECT_ID` - the ID of your Lead Qualifier project
- `VITE_BONSAI_API_KEY` - the API key for the Lead Qualifier project
- `VITE_BONSAI_ENTRY_STAGE_ID` - the ID of the Leas Qualifier stage 
- `VITE_BONSAI_INITIAL_ACTION` - leave this one as `client_provide_user_data`

Use `.env.example` as the template. 

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a local env file from the example:

```bash
cp .env.example .env.local
```

3. Fill in your real Bonsai values in `.env.local`.

4. Start the development server:

```bash
npm run dev
```

Default dev URL: `http://localhost:5174`

