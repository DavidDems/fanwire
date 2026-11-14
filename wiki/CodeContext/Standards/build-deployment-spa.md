---
type: runbook
---

# Rebuilding the SPA

Every frontend change reaches production this way when it is shipped by hand; `deploy.yml` does the same build on an approved run ([[wiki/CodeContext/Standards/build-deployment|Build & Deployment]] "Automated deploy"). The human runs each line, from the repo root unless stated; the pool and client ids are `Fanwire-Auth`'s outputs and do not change unless that stack is replaced.

1. Remove the old build. A stale `dist` is worse than none, because the deploy would upload it.
   ```powershell
   Remove-Item -Recurse -Force frontend\dist
   ```
2. Build **in Docker**, never with a bare `npm run build`: `frontend/.env.local` holds the *dev* pool and Vite reads it in production mode too, so one missing variable would silently ship the dev pool. `.dockerignore` excludes it, and the `build` stage fails on any empty value. `VITE_MEDIA_BASE_URL` is the **site origin**, not `/media`: public keys already start with `media/` and CloudFront forwards `/media/*` unchanged.
   ```powershell
   docker build -f docker\frontend.Dockerfile --target export --output frontend --build-arg VITE_API_BASE_URL=/api --build-arg VITE_MEDIA_BASE_URL=https://fanwire.daviddems.com --build-arg VITE_COGNITO_REGION=ca-central-1 --build-arg VITE_COGNITO_USER_POOL_ID=ca-central-1_eSfPUMRq8 --build-arg VITE_COGNITO_CLIENT_ID=1vskugrl60gggpt0lmib4ka85j .
   ```
3. Check the bundle before uploading it: each production id appears in `dist/assets/*.js`, and neither dev id (from `frontend/.env.local`) appears at all. Count each value separately — the bundle is one minified line, so a multi-pattern `Select-String` reports only the first match and looks like a false failure. Run this once per id, changing the value; production ids print a number above 0, dev ids print 0.
   ```powershell
   [int](Get-ChildItem frontend\dist\assets\*.js | Select-String -AllMatches -Pattern ([regex]::Escape('ca-central-1_eSfPUMRq8')) | ForEach-Object { $_.Matches.Count } | Measure-Object -Sum).Sum
   ```
4. Deploy only the CDN stack, from `infra/`. `--exclusively` skips the seven unchanged stacks (and rebuilding the backend image). A deploy that adds the `BucketDeployment` handler asks to approve its IAM; the set is pinned in `infra/test/iam-policy.test.ts`.
   ```powershell
   npx cdk deploy Fanwire-Cdn --exclusively -c deployFrontend=true --profile fanwire-workload
   ```
5. Check the site serves the new bundle: the output names the new `index-*.js`.
   ```powershell
   (Invoke-WebRequest https://fanwire.daviddems.com/ -UseBasicParsing).Content
   ```
