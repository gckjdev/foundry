# Handoff brief: Move Job limits section in job detail page to a seperate page

Stage reached: **implementing** · harness: claude-code · updated 2026-11-08T05:14:35.070Z

## Plan

_none yet_

## Findings

- implementing: Implementation from the previous run is on the branch and consistent: a new /jobs/[id]/configuration server page holds the two limit forms, the Job limits card and its unused policy/limit code are removed from the job detail page, a Configuration button links to the new page, and both limit actions revalidate the new route. Now running the recipe checks and capturing fresh UI evidence.

## Checks

_not run_

## Questions and answers

- Q: Found the cause of the broken evidence images in PR #55 (not a rendering bug in the screenshot itself).

The PR body embeds screenshots as absolute `http://localhost:3000/api/artifacts/...` URLs, generated from `FOUNDRY_PUBLIC_URL` (default `http://localhost:3000`). GitHub proxies every external image through camo.githubusercontent.com, which fetches the URL server-side. For both images camo returns `404 Cannot proxy the given URL`, because `localhost:3000` is the Foundry machine, not GitHub. I verified the artifact URL is healthy locally (200 / image/png), and the URL is already signed for sessionless access. This works only when `FOUNDRY_PUBLIC_URL` is a publicly reachable HTTPS host (as `deploy/compose.yaml` sets via `https://$FOUNDRY_DOMAIN`); the local default can never work on github.com.

This is outside ticket #53, so I don't want to fold it into this PR without your call. How should I handle it?
  A: Config only, no code: leave Foundry as-is; the fix is to point FOUNDRY_PUBLIC_URL at a public HTTPS host or tunnel for this installation.

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "bb3ba857-92d8-4be8-ab8f-7bc93f392413",
  "title": "Move Job limits section in job detail page to a seperate page",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "2658ad8a-e0d6-4560-aabf-03df1ec5a227",
  "plan": null,
  "findings": [
    "implementing: Implementation from the previous run is on the branch and consistent: a new /jobs/[id]/configuration server page holds the two limit forms, the Job limits card and its unused policy/limit code are removed from the job detail page, a Configuration button links to the new page, and both limit actions revalidate the new route. Now running the recipe checks and capturing fresh UI evidence."
  ],
  "checks": [],
  "qa": [
    {
      "question": "Found the cause of the broken evidence images in PR #55 (not a rendering bug in the screenshot itself).\n\nThe PR body embeds screenshots as absolute `http://localhost:3000/api/artifacts/...` URLs, generated from `FOUNDRY_PUBLIC_URL` (default `http://localhost:3000`). GitHub proxies every external image through camo.githubusercontent.com, which fetches the URL server-side. For both images camo returns `404 Cannot proxy the given URL`, because `localhost:3000` is the Foundry machine, not GitHub. I verified the artifact URL is healthy locally (200 / image/png), and the URL is already signed for sessionless access. This works only when `FOUNDRY_PUBLIC_URL` is a publicly reachable HTTPS host (as `deploy/compose.yaml` sets via `https://$FOUNDRY_DOMAIN`); the local default can never work on github.com.\n\nThis is outside ticket #53, so I don't want to fold it into this PR without your call. How should I handle it?",
      "answer": "Config only, no code: leave Foundry as-is; the fix is to point FOUNDRY_PUBLIC_URL at a public HTTPS host or tunnel for this installation."
    }
  ],
  "uncertainties": [],
  "updatedAt": "2026-11-08T05:14:35.070Z"
}
```
