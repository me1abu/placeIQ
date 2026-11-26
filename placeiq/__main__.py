"""PlaceIQ engine command line (everything runs on this machine).

    python -m placeiq init     add missing secrets (salt, session secret, placement-cell
                               password) to .env (appends; safe to re-run)
    python -m placeiq public   train on the bundled PUBLIC placement datasets (placeiq-data/public)
                               and clear any synthetic demo rows from the database
    python -m placeiq demo     build a full SYNTHETIC demo: data → ingest → train → extraction
                               study → seed the local database (current batch + annotations)
    python -m placeiq serve    start the engine API at http://127.0.0.1:8765 (the UI is the web app in web/)
    python -m placeiq ingest   build the anonymised training table from raw records
                               (same options as `python -m placeiq.ingest --help`)
    python -m placeiq status   show what is set up
"""
from __future__ import annotations

import argparse
import os
import sys

from placeiq import config


def cmd_init(_args) -> None:
    added = config.ensure_env(web=True)
    print((f"Added {', '.join(added)} to" if added else "PlaceIQ secrets already set in") + f" {config.ENV_PATH}")
    if "PLACEIQ_ADMIN_PASSWORD" in added:
        print("  Placement-cell password generated. Find it as PLACEIQ_ADMIN_PASSWORD in .env "
              "(you can change it there and restart).")


def cmd_demo(args) -> None:
    import pandas as pd
    from sqlalchemy import delete

    from placeiq.data.anonymize import hash_identifier
    from placeiq.data.synthetic import generate, write_bundle
    from placeiq.db import Annotation, StudentRecord, session_factory
    from placeiq.extraction import evaluate as ev
    from placeiq.ingest import ingest, load_jds
    from placeiq.model.train import train

    config.ensure_env()
    out = config.DATA_DIR / "synthetic"
    print(f"[1/5] Generating {args.n} synthetic historical students in {out} ...")
    write_bundle(args.n, out)

    print("[2/5] Ingesting (hashing ids, extracting skills, similarity baseline) ...")
    records = pd.read_csv(out / "records.csv")
    hist, stats = ingest(records, out / "resumes", load_jds(), use_sbert=not args.no_sbert)
    hist.to_csv(out / "historical.csv", index=False)
    print(f"      {stats}")

    print("[3/5] Training and evaluating the classifier ...")
    res = train(hist, source="synthetic demo (placeiq-data/synthetic/historical.csv)")
    lr = res["models"]["logistic_regression"]
    print(f"      LR cross-validated AUC {lr['roc_auc_mean']:.3f} ± {lr['roc_auc_sd']:.3f} (SYNTHETIC)")

    print("[4/5] Extraction study on 50 synthetic annotated resumes ...")
    ann = pd.read_csv(out / "annotations.csv")
    texts = {rid: (out / "resumes" / f"{rid}.txt").read_text(encoding="utf-8") for rid in ann.resume_id}
    gold = ev.parse_gold(ann.resume_id, ann.gold_skills)
    er = ev.save(ev.evaluate_texts(texts, gold), "synthetic demo annotations", True)
    print(f"      micro F1 {er['micro']['f1']:.3f} (SYNTHETIC)")

    print("[5/5] Seeding the local database (current batch + annotations) ...")
    current = generate(120, seed=7)
    year = 2026
    from placeiq.explain.guidance import explain, load_bundle
    probs = [r["probability"] for r in explain(load_bundle(config.MODEL_PATH), current)]
    with session_factory()() as s:
        s.execute(delete(StudentRecord).where(StudentRecord.is_synthetic.is_(True)))
        s.execute(delete(Annotation).where(Annotation.annotator == "synthetic"))
        for i, (row, p) in enumerate(zip(current.to_dict("records"), probs)):
            s.add(StudentRecord(student_hash=hash_identifier(f"DEMO{year}{i:04d}"), batch_year=year,
                                branch=row["branch"], cgpa=float(row["cgpa"]),
                                active_backlogs=int(row["active_backlogs"]), internships=int(row["internships"]),
                                projects=int(row["projects"]), certifications=int(row["certifications"]),
                                skills=row["skills"], probability=p, is_synthetic=True))
        for rid in ann.resume_id:
            s.add(Annotation(resume_id=rid, text=texts[rid], gold_skills=";".join(sorted(gold[rid])),
                             annotator="synthetic"))
        s.commit()
    print(f"      {len(current)} synthetic students in batch {year}; {len(ann)} annotations")
    print("\nDemo ready. Everything above is SYNTHETIC and must not be reported as results.")
    print("Start everything with:  start.bat")


def cmd_public(_args) -> None:
    from sqlalchemy import delete

    from placeiq.data.public import OUT, build
    from placeiq.db import Annotation, StudentRecord, session_factory
    from placeiq.extraction import evaluate as ev
    from placeiq.model.train import train

    config.ensure_env()
    print("[1/3] Building the training table from the public datasets ...")
    df = build()
    print(f"      {len(df)} students: " + ", ".join(f"{k} {v}" for k, v in df["source"].value_counts().items()))
    print("[2/3] Training and evaluating (per-source logistic-regression ensemble) ...")
    res = train(df, source=f"public datasets ({OUT.name})")
    lr = res["models"]["logistic_regression"]
    print(f"      cross-validated ROC-AUC {lr['roc_auc_mean']:.3f} ± {lr['roc_auc_sd']:.3f}")
    print("[3/3] Removing synthetic demo rows (shared students, annotations, extraction metrics) ...")
    with session_factory()() as s:
        n1 = s.execute(delete(StudentRecord).where(StudentRecord.is_synthetic.is_(True))).rowcount
        n2 = s.execute(delete(Annotation).where(Annotation.annotator == "synthetic")).rowcount
        s.commit()
    if ev.EXTRACTION_METRICS_PATH.exists():
        import json
        if json.loads(ev.EXTRACTION_METRICS_PATH.read_text()).get("synthetic_data"):
            ev.EXTRACTION_METRICS_PATH.unlink()
    print(f"      removed {n1} synthetic student rows and {n2} synthetic annotations")
    print("\nDone. The model is trained on public benchmark data (not your institution's records).")


def cmd_serve(args) -> None:
    import uvicorn

    config.ensure_env()
    if not config.MODEL_PATH.exists():
        print("NOTE: no trained model yet. Run `python -m placeiq demo`, or train one from the Placement cell → Model page.")
    url = f"http://{args.host}:{args.port}"
    if args.host not in ("127.0.0.1", "localhost", "::1"):
        print(f"WARNING: serving on {args.host}. The engine trusts its caller (the web app checks sign-in), so "
              "anyone who can reach this address can see batch data and retrain the model. Use 127.0.0.1.")
    print(f"PlaceIQ engine API at {url}  (docs: {url}/docs)   Ctrl+C to stop")
    uvicorn.run("placeiq.api.main:app", host=args.host, port=args.port, reload=args.reload, log_level="info")


def cmd_status(_args) -> None:
    import json

    print(f"salt in .env:    {'yes' if os.environ.get('PLACEIQ_SALT') else 'no (run init)'}")
    print(f"database:        {config.database_url()}")
    print(f"data folder:     {config.PQ_DIR}")
    print(f"API address:     http://{config.API_HOST}:{config.API_PORT}")
    if config.METRICS_PATH.exists():
        m = json.loads(config.METRICS_PATH.read_text())
        lr = m["models"]["logistic_regression"]
        print(f"model:           trained {m.get('trained_at')} on {m['n_records']} records "
              f"({'SYNTHETIC' if m.get('synthetic_data') else 'real'}), LR AUC {lr['roc_auc_mean']}")
    else:
        print("model:           none")


def main(argv=None) -> None:
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    argv = sys.argv[1:] if argv is None else argv
    if argv[:1] == ["ingest"]:
        import runpy
        sys.argv = ["python -m placeiq ingest", *argv[1:]]
        runpy.run_module("placeiq.ingest", run_name="__main__")
        return
    ap = argparse.ArgumentParser(prog="python -m placeiq", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init").set_defaults(fn=cmd_init)
    d = sub.add_parser("demo")
    d.add_argument("--n", type=int, default=300)
    d.add_argument("--no-sbert", action="store_true", help="skip Sentence-BERT (faster, no model download)")
    d.set_defaults(fn=cmd_demo)
    s = sub.add_parser("serve")
    s.add_argument("--host", default=config.API_HOST)
    s.add_argument("--port", type=int, default=config.API_PORT)
    s.add_argument("--reload", action="store_true")
    s.set_defaults(fn=cmd_serve)
    sub.add_parser("status").set_defaults(fn=cmd_status)
    sub.add_parser("public").set_defaults(fn=cmd_public)
    args = ap.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
