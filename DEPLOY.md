# Deploying PlaceIQ

PlaceIQ deploys as **one Docker container**: the Python engine stays internal, and only the web app is public.
The model is trained on the bundled public placement datasets while the image builds.

## Render (free), recommended

**What the free plan gives you:**
- a public `https://…onrender.com` URL;
- 512 MB of memory (PlaceIQ uses about 360 MB);
- sleeps after 15 minutes without visitors, and the next visit wakes it in about a minute;
- no persistent disk, so the built-in SQLite database is wiped whenever the app sleeps, restarts or redeploys. That database holds **student accounts** and the profiles students shared with the placement cell, so on Render free you need a free external PostgreSQL database (step 3). Students' own profiles are safe either way, because they live in each student's browser;
- online retraining is switched off (the server is too small). Retrain on your own computer and redeploy (see Updating).

### 1. Put the code on GitHub (you do this)
1. Create a GitHub account if you don't have one, then **New repository**, e.g. `placeiq`. Private is fine.
2. Push this folder. It's already a git repository with a first commit:
   ```powershell
   git remote add origin https://github.com/YOUR-USERNAME/placeiq.git
   git push -u origin main
   ```

### 2. Create the service on Render (you do this)
1. Sign up at https://render.com with your GitHub account (no card needed for the free web service).
2. **New → Blueprint**, then pick the `placeiq` repository. Render reads `render.yaml`.
3. When asked for `PLACEIQ_ADMIN_PASSWORD`, type the placement-cell password. `PLACEIQ_SALT` and `PLACEIQ_SESSION_SECRET` are generated for you.
4. When asked for `DATABASE_URL`, paste the connection string from step 3 below (you can also add it later under **Environment**).
5. **Apply**. The first build takes about 10–15 minutes. Then open the URL Render shows.

### 3. Add a free PostgreSQL database (you do this)
Without it, every student has to create their account again each time the free server wakes up.
1. Create a free database at https://neon.tech (or Supabase). No card needed.
2. Copy its connection string (it starts with `postgresql://` or `postgres://`, and usually ends in `?sslmode=require`).
3. Paste it as `DATABASE_URL` in Render. PlaceIQ creates its tables on first start.

### Updating
- **Code changes:** commit and `git push`. Render rebuilds automatically.
- **New model:** on your own computer, run `start.bat` and train on the Model page, or run `.venv\Scripts\python -m placeiq public`. Then copy the training data into the image build:
  - put your processed CSV in `placeiq-data/processed/`;
  - change the training line in the Dockerfile (`RUN ... python -m placeiq public`) to train on it, e.g. `python -m placeiq.model.train --data placeiq-data/processed/historical.csv`;
  - make sure `.gitignore` doesn't exclude that file. Only commit **anonymised** data (hashed ids, no names).

## Hugging Face Spaces (paid)
Docker Spaces need a PRO subscription (about $9/month). With PRO: run `deploy\hf_upload.py YOUR-USERNAME/placeiq` (after
`hf auth login`), then add the secrets `PLACEIQ_ADMIN_PASSWORD`, `PLACEIQ_SALT` and `PLACEIQ_SESSION_SECRET` in the Space settings. Retraining works
there, so don't set `PLACEIQ_DISABLE_TRAINING`.

## Settings reference
| Variable | Purpose |
|---|---|
| `PLACEIQ_ADMIN_PASSWORD` | Placement-cell password. If unset, nobody can sign in to the placement-cell pages. |
| `PLACEIQ_SALT` | Long random secret for hashing roll numbers. Keep it the same forever: changing it orphans every student account and shared profile. |
| `PLACEIQ_SESSION_SECRET` | Long random secret that signs sign-in cookies. Changing it signs everyone out. If unset, everyone is signed out whenever the app restarts. |
| `PLACEIQ_DISABLE_TRAINING` | `1` turns off online retraining (small servers). |
| `DATABASE_URL` | External PostgreSQL database, so student accounts and shared profiles survive restarts. Required on hosts without a persistent disk (Render free). `postgres://` and `postgresql://` URLs both work. |

## Test the container locally
```powershell
docker build -t placeiq .
docker run --rm -p 7860:7860 -e PLACEIQ_ADMIN_PASSWORD=change-me -e PLACEIQ_SALT=some-long-random-string -e PLACEIQ_SESSION_SECRET=another-long-random-string -e PLACEIQ_DISABLE_TRAINING=1 placeiq
```
Then open http://localhost:7860.
