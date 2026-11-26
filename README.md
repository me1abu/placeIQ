# PlaceIQ

**Placement readiness prediction and skill-gap analysis using machine learning and explainable AI.**

Minor project, B.Tech CSE, Guru Tegh Bahadur Institute of Technology (GGSIPU), 2023–2027:

Saurabh Raj, Abu Bakar, Punit Singh.

PlaceIQ estimates a student's chance of campus placement with a model trained on recorded placement outcomes, explains each estimate with SHAP, identifies the changes most likely to improve readiness, and provides the placement cell with a batch-level view and training groups.

Its central experiment tests whether resume–JD similarity—which is commonly shown to students—predicts placement as effectively as an outcome-trained classifier.

It runs locally with one click, or deploys online as a single Docker container (see [Deploying](#deploying)).

---

## Quick Start (Windows)

Double-click `start.bat`, or run it from a terminal:

```powershell
.\start.bat
```

The first run:

- Installs Python and Node.js packages.
- Adds a random `PLACEIQ_SALT` to `.env`.
- Trains the model on the bundled public placement datasets.
- Builds the web app.
- Opens [http://127.0.0.1:3100](http://127.0.0.1:3100).

Subsequent starts should complete within seconds.

### Requirements

- Python 3.10+
- Node.js 20.9+

> **The model is trained on public placement datasets, not GTBIT's records.** The app says so on every page and lists the sources under **About → The data behind the model**. Retrain on your own records (Model page) before reporting results as findings.

To stop PlaceIQ, close the web-app terminal window and the minimized **PlaceIQ engine** window.

---

## Using PlaceIQ

### Signing in

Everyone signs in at **/login**, which has two tabs:

- **Student**: roll number and password. On first use, choose **Create a student account**. The roll number is stored only as a salted, irreversible code, and the password only as a PBKDF2 hash.
- **Placement cell**: the shared placement-cell password (`PLACEIQ_ADMIN_PASSWORD` in `.env`). The first run of `start.bat` generates one; change it in `.env` and restart.

Students can't open placement-cell pages or the admin API, and they don't see those menu items. A student can only share or withdraw their own profile. If a student forgets their password, the placement cell can reset their sign-in from the Batch dashboard.

### Students

1. **Profile and CV** — Upload a PDF or paste a CV. PlaceIQ extracts skills, projects, internships, certifications, and CGPA where available. Confirm the branch, CGPA, backlogs, and batch, then save the profile.
2. **Home** — View the readiness estimate, best next step, and roadmap summary.
3. **Readiness report** — View the probability and readiness band, SHAP drivers, and ranked advice.
4. **What-if simulator** — Adjust profile factors and skills to see live model estimates, ranked next steps, and optional simulated improvements.
5. **Roadmap** — View missing skills for each role and recruiters grouped into eligible, within-reach, and out-of-reach categories.
6. **Share (optional)** — Share readiness information with consent. The roll number is converted into an irreversible code, and sharing can be withdrawn at any time.

### Placement Cell

- **Batch dashboard** — Review a shared batch or uploaded CSV, readiness bands, training groups, factors, skill coverage, exports, and batch deletion.
- **Model** — Upload historical CSV data and train. View cross-validation AUC with confidence intervals, logistic regression versus random forest results, coefficients, and figures.
- **Evaluation** — Run the extraction study, resume–JD similarity comparison, and fairness audit.
- **Annotate** — Label 50 resumes for the extraction study.

---

## Real-Data Workflow

1. Collect records using the layout described in [placeiq-data/README.md](placeiq-data/README.md), and obtain consent.

2. Run intake to hash identifiers, extract skills, and compute the similarity baseline:

   ```powershell
   .venv\Scripts\python -m placeiq ingest `
     --records raw\records.csv `
     --resumes raw\resumes `
     --out placeiq-data\processed\historical.csv
   ```

3. Open the **Model** page, upload `historical.csv`, and select **Train and deploy**.

4. Annotate 50 resumes, open **Evaluation**, and run the extraction and similarity analyses.

5. Replace the placeholder recruiters in `placeiq-data/companies.json` and the generic job descriptions in `placeiq-data/jds/`.

6. Replace the public-data model by training on your own `historical.csv` (step 3).

---

## Training Data

Until GTBIT's records are collected, the model is trained on two public datasets (11,065 students after removing duplicates), with one sub-model per dataset so no missing values are invented:

| Dataset | Students | Columns used | Licence |
|---|---|---|---|
| [Campus Recruitment CSV](https://huggingface.co/datasets/Krooz/Campus_Recruitment_CSV) | 9,928 | CGPA, internships, projects, certifications | CC0 |
| [College Placement (collegePlace.csv)](https://github.com/Asmi-va/College_placement_predictor) | 1,137 | Branch, CGPA, internships, backlogs, gender | Not stated |

Both show signs of being generated themselves, and neither contains skills, so treat estimates as illustrative. Rebuild with `.venv\Scripts\python -m placeiq public`.

---

## Deploying

PlaceIQ deploys as one Docker container (`Dockerfile`), with a blueprint for Render's free plan (`render.yaml`). The placement-cell pages are protected by the `PLACEIQ_ADMIN_PASSWORD` secret, and each student's profile stays in their own browser. Step-by-step instructions are in [DEPLOY.md](DEPLOY.md).

---

## Project Layout

```text
placeiq/
  extraction/   PDF text extraction, skill taxonomy matching, profile drafts, extraction study
  features/     Feature table; rounds cleared and gender are never used as features
  model/        Training, cross-validation, bootstrap confidence intervals, fairness audit
  explain/      SHAP guidance and what-if scoring
  baseline/     TF-IDF, Sentence-BERT similarity, and comparison experiment
  data/         Public-dataset loader, anonymisation, synthetic test data
  roadmap.py    Role and recruiter gaps
  cohort.py     Batch summaries and training groups
  api/          HTTP API used by the web app
placeiq-data/
  companies.json
  jds/
  templates/
  database/
  datasets/
  artifacts/
  # Personal data is git-ignored
web/
  Next.js interface at 127.0.0.1:3100
  /api/engine proxies to the engine at 127.0.0.1:8765
tests/
  pytest tests
notebooks/
  Evaluation notebooks
start.bat
  One-click launcher
Dockerfile, render.yaml, DEPLOY.md
  Deployment
```

---

## Development

```powershell
# Install development dependencies
.venv\Scripts\pip install -r requirements-dev.txt

# Run engine tests
.venv\Scripts\python -m pytest

# Start the engine with auto-reload
.venv\Scripts\python -m placeiq serve --reload

# Start the web app
cd web
npm run dev

# Run web type checking
npm run typecheck
```

---

## Credits

Visual design is inspired by [career-ops](https://github.com/career-ops-hq/career-ops), licensed under MIT.

Fonts:

- Inter — SIL Open Font License
- Instrument Serif — SIL Open Font License

The bundled font files are located in `web/src/assets/fonts`.
