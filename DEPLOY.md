# Publish this NEW repo to GitHub and Render

The supplied files and Git history are for a **new** GitHub repository named **`Underage-Driving`**. The existing LOGIX repository and existing Render URL should not be overwritten without an explicit migration decision.

## GitHub: create new empty repository

In your GitHub account (`strangespider2009-star`), open **New repository** and set the name to **Underage-Driving**. Keep it **empty**: do not pre-add a README, `.gitignore`, or license (these already exist in the supplied project). An empty repo allows the included 100-commit history to push without a conflict.

### Option A: ZIP containing `.git`

Extract the full `Underage-Driving_with_git_history.zip` archive. In the extracted `Underage-Driving` folder, run:

```bash
git log --oneline -5
git rev-list --count HEAD
git remote add origin https://github.com/strangespider2009-star/Underage-Driving.git
git branch -M main
git push -u origin main
```

You should see 100+ nonempty local commits before pushing. Sign in using GitHub's supported credential manager or GitHub Desktop, not a password pasted into a URL.

### Option B: Git bundle

```bash
git clone Underage-Driving-100-commits.bundle Underage-Driving
cd Underage-Driving
git remote remove origin  # only if Git reports that a bundle remote is present
git remote add origin https://github.com/strangespider2009-star/Underage-Driving.git
git push -u origin main
```

### If GitHub says repository not found

Create the new repository in your GitHub account first, check the owner/name spelling, and make sure you have permission to push.

## Render

1. Render → **New** → **Web Service** → connect `strangespider2009-star/Underage-Driving`.
2. Name: `underage-driving` (or another available name).
3. Build: `npm install --include=dev && npm run check && npm run build`.
4. Start: `npm start`.
5. Env: `NODE_ENV=production`; `SESSION_SECRET` randomly generated 32+ characters.
6. Add durable `DATA_DIR` storage if you want users/drivers/hardware jobs to survive restarts. Free/ephemeral web service instances lose local JSON data on reset; a durable hosted DB is a future improvement.
7. Visit your **new** service domain and register your ESP32 in **Setup guide**.
8. Put the **new domain**, unique device ID, and secret into `firmware/ESP32_LOGIX/config.h` before upload. The old LOGIX Render URL does not have this device API.

## Before demonstrations

Run `npm run check` and review the truth table in WIRING.md. Test on a bench using LEDs and an active buzzer only. For real security, build server-side facial verification, liveness checks, secure hardware keys, database storage, and independent authorization procedures; the current browser-generated face result must not be used to authorize a safety-critical action.
