# 🌿 Roamly — Turn Your Mood Into an Outdoor Experience

### *Less scrolling. More exploring.*

**What if AI didn't just give you another answer to read, but helped you step outside and experience the world?**

Roamly is an AI-powered outdoor discovery application that transforms how you feel into a personalized walking experience. Instead of endlessly scrolling through recommendations, users can describe their mood, share what they feel like doing, and discover real public places that fit their preferences.

Powered by a locally running Gemma model, real-world map data, and walking-route services, Roamly explores a different kind of AI interaction: one that encourages people to disconnect from their screens and reconnect with the world around them.

> **The best AI interaction is sometimes walking away from the screen.**

---

## ✨ The Idea Behind Roamly

We use technology throughout the day to find entertainment, information, and recommendations. Yet most recommendation systems focus on what we should watch, buy, or consume next.

Roamly takes a different approach.

What if your next recommendation were a peaceful garden, a public walking path, a riverside, or an interesting place nearby?

Roamly connects three things that are usually separate:

- **How you feel** — your mood and personal description.
- **Where you can go** — real-world public places discovered from map data.
- **What you experience** — a walking journey designed around your preferences.

The goal is simple: turn a digital interaction into a meaningful offline experience.

## 🚀 How Roamly Works

### 01. Start With Your Mood

Choose a mood that reflects how you feel:

- 😌 Peaceful
- 😵 Stressed
- 🧍 Lonely
- 🥱 Bored
- ⚡ Energetic
- 🔎 Curious

Describe your current feeling in your own words. Roamly combines your selected mood with your description rather than relying on a mood label alone.

### 02. Personalize Your Walk

Set preferences such as:

- Available time
- Preferred distance
- Walking difficulty
- Crowd level
- Preferred environment

These preferences help shape the type of outdoor experience you're looking for.

### 03. Let AI Help Shape the Experience

Roamly uses a locally hosted **Gemma 3 4B model through Ollama** to interpret the user's input and help generate a personalized walking experience.

The intention is not to diagnose emotions or provide medical advice. Mood is simply an input for personalizing an outdoor activity.

### 04. Discover Real Places

Roamly uses OpenStreetMap data and the Overpass API to discover nearby places relevant to an outdoor walk.

Possible destinations include public parks, gardens, walking paths, riverside areas, viewpoints, and other suitable public spaces.

Place discovery depends on available map data, provider availability, and successful validation. Roamly should not invent locations or claim that a place is accessible when this has not been verified.

### 05. Turn a Destination Into a Route

The application uses OSRM's routing service with its walking profile to obtain walking routes where supported.

Mapbox provides the map interface for viewing destinations and routes.

This creates a connection between AI-generated recommendations and real-world geography.

### 06. Take the Experience Offline

The purpose of Roamly is not to keep users interacting with an AI indefinitely.

It is to help them choose a destination, leave the screen behind, and experience the outside world.

---

## 🧠 What Makes Roamly Different?

| Traditional recommendation experience | Roamly's approach |
|---|---|
| Starts with content or a search query | Starts with mood and personal intent |
| Optimizes for another digital interaction | Encourages an outdoor activity |
| Often treats recommendations as generic | Combines personal input with walk preferences |
| Can present places without a complete journey | Connects place discovery with walking routes |
| Keeps the experience on-screen | Aims to move the experience into the real world |

Roamly is an exploration of **mood-aware, location-grounded AI** — AI that can help people make decisions about their physical environment instead of only their digital one.

## 🛠️ Technology Stack

### Frontend
- **Next.js** — application framework
- **React** — component-based user interface
- **TypeScript** — type safety
- **Tailwind CSS** — responsive styling
- **Mapbox** — interactive map visualization

### Backend
- **Node.js** — JavaScript runtime
- **Express.js** — REST API
- **MongoDB** — persistent application data

### AI
- **Ollama** — local model runtime
- **Gemma 3 4B** — locally hosted language and multimodal model

### Real-World Data and Routing
- **OpenStreetMap (OSM)** — geographic and place data
- **Overpass API** — querying OpenStreetMap features
- **OSRM** — walking-route calculation

### Architecture at a Glance

```text
┌───────────────────────────────┐
│      Next.js Frontend         │
│ Mood • Preferences • Map      │
└──────────────┬────────────────┘
               │ REST API
               ▼
┌───────────────────────────────┐
│       Express Backend         │
│ Validation • AI • Discovery   │
│ Routing • Application Logic   │
└───────┬───────────┬───────────┘
        │           │
        ▼           ▼
┌──────────────┐ ┌─────────────────┐
│ Ollama       │ │ OSM / Overpass  │
│ Gemma 3 4B   │ │ Real Place Data │
└──────────────┘ └────────┬────────┘
                          ▼
                 ┌─────────────────┐
                 │ OSRM Walking    │
                 │ Route Service   │
                 └─────────────────┘

        Express Backend
               │
               ▼
        ┌─────────────┐
        │  MongoDB    │
        └─────────────┘
```

The frontend communicates with the backend, while the backend coordinates AI processing, place discovery, routing, and persistence. The local AI runtime remains separate from the browser.

## 🔒 A Local-First AI Approach

One of the important design decisions in Roamly is using a locally running model rather than making a hosted AI API a mandatory part of the experience.

With Ollama and Gemma running on the user's machine:

- AI inference can run locally.
- No hosted generative-AI API key is required for the local Gemma workflow.
- The application can be developed and demonstrated without a cloud AI inference service.
- Model availability and response time depend on the local hardware and installed model.

**Important distinction:** Local AI inference does not mean the entire application is offline or that all user data stays on the device. Map discovery, routing, and database operations may communicate with external services, and application data may be persisted in MongoDB.

## 🏗️ Project Structure

```text
roamly/
├── app/
│   └── page.tsx
├── components/
│   └── roamly-map.tsx
├── lib/
│   ├── api.ts
│   └── types.ts
├── server/
│   ├── app.js
│   ├── server.js
│   ├── config/
│   │   └── db.js
│   ├── models/
│   └── services/
│       ├── aiService.js
│       ├── routeService.js
│       └── imageService.js
├── .env.example
├── package.json
└── README.md
```

*This is a simplified overview. The exact repository may contain additional components, routes, models, and tests.*

## ⚙️ Run Roamly Locally

### Prerequisites

Install the following:

- Node.js and npm
- MongoDB Atlas account or a compatible MongoDB instance
- Ollama
- The `gemma3:4b` model
- A Mapbox access token

### 1. Clone the Repository

```bash
git clone YOUR_GITHUB_REPOSITORY_URL
cd YOUR_PROJECT_DIRECTORY
npm install
```

Replace the placeholders with your actual GitHub repository URL and directory name.

### 2. Install and Start the AI Model

Install Ollama from [ollama.com](https://ollama.com).

Download the model:

```bash
ollama pull gemma3:4b
```

Make sure the Ollama service is running. On systems where it is not already running as a background service, use:

```bash
ollama serve
```

Keep the AI service running while using the application.

### 3. Configure the Backend

Create `server/.env` using the appropriate values for your environment:

```env
PORT=5000
CLIENT_URL=http://localhost:3000

MONGODB_URI=YOUR_MONGODB_CONNECTION_STRING

OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=gemma3:4b
```

Use the environment variable names expected by the repository. If the project uses additional configuration variables, copy their names from `.env.example`.

### 4. Configure the Frontend

Create `.env.local` in the project root:

```env
NEXT_PUBLIC_API_URL=http://localhost:5000/api
```

Configure your Mapbox token using the exact environment variable name expected by the existing map component.

**Never commit real database credentials, API tokens, or other secrets to GitHub.**

### 5. Start the Backend

Open a terminal:

```bash
cd server
npm start
```

If your backend uses a different start script, check `server/package.json`.

### 6. Start the Frontend

Open another terminal in the project root:

```bash
npm run dev
```

Open the application:

**http://localhost:3000**

Keep the backend, frontend, MongoDB connection, and Ollama service available while testing the complete experience.

## 🧪 Testing and Reliability

Roamly is intended to connect AI output to actual services instead of relying on fabricated demonstration data.

Testing should cover:

- API health and backend error handling
- AI availability and model response validation
- Place-provider failures and timeouts
- Invalid or unavailable route responses
- Frontend TypeScript checks and production builds
- Image input validation and image-analysis errors, where the feature is connected

The project has previously passed a TypeScript check, a production build, and 21 backend tests. These results describe earlier local checks, not a guarantee that every integration is currently working.

External map and routing providers can fail temporarily. A reliable application should communicate those failures clearly instead of displaying invented places or routes.

## 🌱 Current Development Status

Roamly is an evolving project. Its core direction is mood-based outdoor discovery, supported by a local AI model and real-world geographic services.

| Area | Status |
|---|---|
| Mood-based walk experience | Core workflow |
| Local Ollama + Gemma integration | Implemented and locally tested |
| OpenStreetMap / Overpass discovery | Integrated; provider reliability needs validation |
| OSRM walking routes | Integrated; live availability must be verified |
| Mapbox visualization | Integrated |
| MongoDB persistence | Configured |
| Photo discovery UI and end-to-end flow | Verify in the current build before claiming complete |
| Full browser-based walking lifecycle | Requires end-to-end verification |

This status is intentionally transparent: an integration being present in the code does not automatically mean every live provider request or browser interaction works in every environment.

## 🗺️ Roadmap

The next stages of development focus on making the experience more dependable and useful.

- [ ] Improve place-discovery reliability with bounded retries and provider error handling.
- [ ] Rank destinations by relevance, distance, public accessibility, and user preferences.
- [ ] Verify that place names, map markers, route destinations, and saved records remain consistent.
- [ ] Complete and test the photo-discovery interface with local multimodal AI.
- [ ] Validate browser geolocation, walking progress, and route-related states end to end.
- [ ] Improve accessibility and responsive mobile layouts.
- [ ] Expand automated integration tests for external provider failures.
- [ ] Evaluate adaptive recommendations based on genuine user feedback and completed experiences.

Roadmap items will be marked complete only after their implementation and behavior have been verified.

## 🌍 Why This Project Matters

Roamly is built around a simple question:

**Can AI help us spend less time consuming digital content and more time experiencing the world?**

The project brings together local AI inference, geographic data, walking routes, and personalized interaction to explore that possibility.

It is also an engineering challenge: AI recommendations must be grounded in real places, routes must come from a routing service, external failures must be handled honestly, and user-facing claims must match actual application behavior.

That combination of human-centered design and practical systems integration is what Roamly aims to demonstrate.

## 🤝 Contributing

Contributions are welcome.

1. Fork the repository.
2. Create a feature branch.
3. Make a focused change.
4. Test the change locally.
5. Open a pull request describing the problem, implementation, and verification performed.

Ideas for contributions include better place filtering, routing reliability, accessibility, test coverage, and improvements to the mood-based discovery experience.

## 👣 The Roamly Philosophy

> **Technology should not always ask for more of our attention. Sometimes, it should help us give our attention back to the world.**

**Roamly — Find your feeling. Find your path. Go outside.** 🌿
