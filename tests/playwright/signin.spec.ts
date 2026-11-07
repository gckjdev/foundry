import { expect, test } from "@playwright/test";

test("sign-in page offers GitHub and explains the product", async ({ page }) => {
  await page.goto("/signin");
  await expect(page.getByRole("heading", { name: "Tickets in. Merged PRs out." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in with GitHub" })).toBeVisible();
  await expect(page.getByText("Label a GitHub issue")).toBeVisible();
});

test("sign-in shows a recoverable error from the query string", async ({ page }) => {
  await page.goto("/signin?error=AccessDenied");
  await expect(page.getByText("GitHub access was denied.")).toBeVisible();
});
