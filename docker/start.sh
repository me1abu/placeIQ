#!/bin/sh
# Container entrypoint: the PlaceIQ engine on 127.0.0.1:8765 (internal only) and the web app
# on 0.0.0.0:$PORT (7860 on Hugging Face Spaces). Only the web app is reachable from outside.
set -e
cd /app

# Use persistent storage when the platform provides it (Hugging Face mounts it at /data).
if [ -z "$DATABASE_URL" ] && [ -d /data ] && [ -w /data ]; then
  export DATABASE_URL="sqlite:////data/placeiq.db"
  echo "[PlaceIQ] Using persistent database at /data/placeiq.db"
fi
if [ -z "$PLACEIQ_SALT" ]; then
  echo "[PlaceIQ] WARNING: PLACEIQ_SALT secret is not set; a temporary one is used, so shared-profile codes change on restart."
fi
if [ -z "$PLACEIQ_ADMIN_PASSWORD" ]; then
  echo "[PlaceIQ] WARNING: PLACEIQ_ADMIN_PASSWORD secret is not set; nobody can sign in to the Placement cell pages."
fi
if [ -z "$PLACEIQ_SESSION_SECRET" ]; then
  echo "[PlaceIQ] WARNING: PLACEIQ_SESSION_SECRET secret is not set; everyone is signed out whenever the app restarts."
fi

python -m placeiq serve --host 127.0.0.1 --port 8765 &
exec node web/server.js
