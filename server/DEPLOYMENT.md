# Roamly backend on Render

The backend Docker image runs the existing Express API and Ollama in one
container. Express is the only public HTTP server and binds to `0.0.0.0` on
Render's `PORT`. Ollama binds to `127.0.0.1:11434` inside the container.

## Render service settings

Create or update the **backend web service** with these settings:

- **Runtime / Language:** Docker (not Node).
- **Root Directory:** `server`.
- **Dockerfile Path:** `Dockerfile`.
- **Health Check Path:** `/api/health`.
- **Start command:** leave the Docker command unset; the Docker entrypoint runs
  `start.sh`.
- **PORT:** let Render supply this value; do not set it to `11434`.

Set these environment variables in Render's dashboard. Do not commit secrets:

| Variable | Value |
| --- | --- |
| `MONGODB_URI` | MongoDB Atlas connection string |
| `CLIENT_URL` | Deployed frontend origin |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | `gemma3:4b` |

Render supplies `PORT`. Preserve any other existing backend variables required
by the deployment (for example, provider endpoints); never put credentials or
Mapbox secrets in this repository or in image build arguments.

## Compute and model storage

Gemma 3 4B is approximately 3.3 GB in the current Ollama model listing. The
model needs additional RAM while loaded, in addition to Node, Ollama, and the
container runtime. Use a **paid web-service compute plan with at least 8 GB
RAM and 2 CPUs** as a practical minimum; 4 CPUs or more is preferable for CPU
inference. A free or 2–4 GB plan is not a viable production target for this
combined workload. CPU-only inference can still be slow; measure latency on the
selected plan before relying on it for interactive traffic.

Use a paid plan (Render's free web services cannot attach a persistent disk and
spin down when idle). For a more practical CPU-inference profile, select at
least **4 CPUs and 8 GB RAM** if available; do not go below the 8 GB memory
minimum. Attach a **20 GB persistent disk** at `/var/lib/ollama`. The image sets
`OLLAMA_MODELS=/var/lib/ollama/models`, so the model survives container
restarts and redeploys. Render's disk-backed services run a single instance and
do not get zero-downtime deploys. Without a persistent disk, the model is
downloaded again after a restart or redeploy, and cold-start time depends on
model-download speed. The first model pull can also exceed Render's new-deploy
health-check window if download bandwidth is slow; the service intentionally
does not start Express before the pull and model check finish.

In the Render dashboard, choose the smallest paid plan that meets the CPU/RAM
requirements above (4 CPUs / 8 GB RAM is the recommended selection) and a
20 GB disk. Plan identifiers and availability can change; the current service
plan cannot be determined from this repository.

The plan selected for the existing Render service was not available in the
repository, so verify its RAM/CPU in the Render dashboard before deploying.

## Deploy

1. In Render, open the backend service's **Settings** and change its runtime
   from **Node** to **Docker**.
2. Set the root directory to `server` and Dockerfile path to `Dockerfile`.
3. Add the required environment variables above and configure the paid compute
   plan and disk mount.
4. Set `/api/health` as the HTTP health-check path.
5. Save and manually deploy. The frontend deployment does not need to change.
6. Confirm deploy logs report that Ollama and `gemma3:4b` are ready before
   Express starts, then check the service's `/api/health` URL. Its `ai.status`
   and `ai.modelAvailable` fields are derived from Ollama's live model list.

## Local development

Keep running Ollama on the host at `http://127.0.0.1:11434` with `gemma3:4b`
installed. Set `OLLAMA_BASE_URL` and `OLLAMA_MODEL` in `server/.env` as needed,
then start the backend from the repository root with `npm run server` (or from
`server` with `npm run dev`). The container startup script is only used by the
Docker deployment.
