import { test, expect } from '@playwright/test';

test('welcome is usable before external accounts are connected', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(
    page.getByRole('heading', {
      name: 'Sign in',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Email me a sign-in link' }),
  ).toBeDisabled();
  await expect(page.getByText('Sign-in is not available yet.')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: `test-results/welcome-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test('a member without a display name can invite a friend', async ({
  page,
}) => {
  await page.route('**/api/status', (route) =>
    route.fulfill({ json: { signInAvailable: true } }),
  );
  await page.route('**/api/me', (route) =>
    route.fulfill({ json: { user: { id: 'test-member', name: '' } } }),
  );
  await page.route('**/api/invitations', async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      email: 'friend@example.com',
    });
    await route.fulfill({
      status: 201,
      json: { invitation: { id: 'test-invitation' } },
    });
  });
  await page.goto('/');
  await expect(page.getByText('You’re signed in.')).toBeVisible();
  await page.getByLabel('Invite a friend by email').fill('friend@example.com');
  await page.getByRole('button', { name: 'Create invitation' }).click();
  await expect(page.getByRole('status')).toContainText(
    'Invitation ready for friend@example.com',
  );
  await expect(page.getByRole('status')).toContainText(
    'We haven’t emailed them.',
  );
});

test('email sign-in gives a non-enumerating confirmation', async ({ page }) => {
  await page.route('**/api/status', (route) =>
    route.fulfill({ json: { signInAvailable: true } }),
  );
  await page.route('**/api/me', (route) =>
    route.fulfill({ status: 401, json: { error: 'Sign in to continue.' } }),
  );
  await page.route('**/api/auth/sign-in/magic-link', (route) =>
    route.fulfill({ json: { status: true } }),
  );
  await page.goto('/');
  await page
    .getByLabel('Your email', { exact: true })
    .fill('friend@example.com');
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(
    page.getByRole('heading', { name: 'Check your email.' }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toContainText(
    'If you’re a member or have an active invitation',
  );
});
