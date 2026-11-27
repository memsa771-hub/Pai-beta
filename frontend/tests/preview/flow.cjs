/* A-K behaviour checks on the redesigned UI, offline with fake data.
 * Each step proves a product boundary, not just that a screen renders. */
const assert = require('node:assert/strict');

const calls = (page) => page.evaluate(() => window.__offlineCalls);
const called = async (page, method) => (await calls(page)).filter((call) => call.method === method);

module.exports = async function flow(browser, open, ORIGIN) {
  const { context, page, errors } = await open(browser, 1440, 'light');
  const go = (path) => page.goto(`${ORIGIN}${path}${path.includes('?') ? '&' : '?'}theme=light`);
  try {
    // A: three entry steps; a required step cannot be skipped; no reply
    // language; Pakistan is the data default; no provider call.
    await go('/student?onboarding=1');
    assert.equal(await page.locator('ol[aria-label^="Step"] > li').count(), 3, 'three onboarding steps');
    assert.equal(await page.locator('form input:visible').count(), 2, 'step 1 asks first and last name only');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByText('Please fill this in.').first().waitFor();
    assert.equal(await page.getByText('Step 1 of 3').count(), 1, 'an empty required step does not advance');
    await page.getByLabel('First name', { exact: true }).fill('Sam');
    await page.getByLabel('Last name', { exact: true }).fill('Taylor');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Other', exact: true }).click();
    await page.getByPlaceholder('Type it in your own words').fill('Secondary education');
    await page.getByRole('button', { name: 'Studying now', exact: true }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Date of birth' }).click();
    await page.getByRole('option', { name: '2008', exact: true }).click();
    await page.getByRole('option', { name: 'Mar', exact: true }).click();
    await page.getByRole('button', { name: 'March 12, 2008' }).click();
    await page.getByRole('button', { name: 'Female', exact: true }).click();
    assert.equal(await page.getByLabel('Country').inputValue(), 'Pakistan', 'country defaults to Pakistan');
    await page.getByLabel('City').fill('My city');
    assert.equal(await page.getByText(/reply language/i).count(), 0, 'no reply-language question');
    // The preview reloads into the workspace on finish; keep the recorded call.
    await page.evaluate(() => addEventListener('pagehide', () => sessionStorage.setItem('entryCalls', JSON.stringify(window.__offlineCalls))));
    await page.getByRole('button', { name: 'Start with PAI' }).click();
    await page.waitForURL('**view=threads');
    const entry = (await page.evaluate(() => JSON.parse(sessionStorage.getItem('entryCalls') || '[]')))
      .filter((call) => call.method === 'submitOnboarding').at(-1);
    assert.deepEqual(entry && entry.args[0], { firstName: 'Sam', lastName: 'Taylor', level: 'Secondary education',
      status: 'current', dateOfBirth: '2008-03-12', gender: 'female', currentCountry: 'Pakistan', currentCity: 'My city' }, 'entry answers sent as typed');

    // B-D: the conversation, and a journey with every A-K stage present.
    await page.getByRole('navigation').getByRole('button', { name: 'Journey', exact: true }).click();
    await page.getByRole('heading', { name: 'Your journey, at your pace' }).waitFor();
    assert.equal(await page.locator('main ol > li').count(), 11, 'all eleven stages');
    assert.equal(await page.locator('main ol > li[aria-current="step"]').count(), 1, 'exactly one current stage');

    // E: the Mirror is drawn from the Vault; nothing to confirm. "Tell PAI"
    // on what is still unknown only fills a chat draft, and "This is wrong"
    // opens the Vault entry.
    await go('/student?view=mirror');
    await page.getByRole('heading', { level: 1, name: 'Sam Taylor' }).waitFor();
    assert.equal(await page.getByRole('button', { name: /confirm|that is right/i }).count(), 0, 'no confirm on the Mirror');
    const sentBeforeTell = (await called(page, 'sendMessage')).length;
    await page.getByRole('region', { name: 'Still unknown' }).getByRole('button', { name: 'Tell PAI about Pressures & limits' }).click();
    await page.waitForFunction(() => /budget/.test(document.querySelector('textarea[data-chat-input]')?.value || ''), null, { timeout: 5000 });
    assert.equal((await called(page, 'sendMessage')).length, sentBeforeTell, 'Tell PAI is a draft, not a send');
    await go('/student?view=mirror');
    await page.getByRole('button', { name: 'This is wrong: Matric Science, 81%' }).click();
    await page.getByRole('dialog').waitFor();
    assert.match(page.url(), /view=profile/, 'This is wrong opens the Vault');

    // F-I: Paths only. No Explore and no Roadmap; paths are compared side by
    // side and one is chosen with one explicit confirm. Nothing is chosen for
    // the student, and asking about the chosen path is a chat draft, not a send.
    await page.keyboard.press('Escape'); // close the Vault entry dialog the step above opened
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.getByRole('navigation').getByRole('button', { name: 'Paths', exact: true }).first().click();
    await page.getByRole('heading', { name: 'Your paths' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Explore', exact: true }).count(), 0, 'no Explore on Paths');
    assert.equal(await page.getByRole('group', { name: 'Sections' }).count(), 0, 'Paths has no Roadmap tab');
    for (const title of ['Practical design', 'Applied computing']) await page.getByRole('checkbox', { name: `Compare ${title}` }).check();
    await page.getByRole('button', { name: 'Compare (2)' }).click();
    await page.getByRole('dialog').getByText('ECAT / NET').waitFor();
    assert.deepEqual((await called(page, 'comparePaths')).at(-1).args, [['path-one', 'path-two']], 'the table reads the picked paths');
    await page.keyboard.press('Escape');
    assert.equal((await called(page, 'changePossibility')).length, 0, 'no automatic choice');
    await page.getByRole('button', { name: 'Choose', exact: true }).nth(1).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Yes, choose it' }).click();
    await page.getByRole('button', { name: 'Ask PAI', exact: true }).waitFor();
    assert.deepEqual((await called(page, 'changePossibility')).map((call) => call.args), [['path-two', 'choose']], 'one explicit choice');
    const sentBefore = (await called(page, 'sendMessage')).length;
    await page.getByRole('button', { name: 'Ask PAI', exact: true }).click();
    await page.waitForFunction(() => /^I chose Applied computing\./.test(document.querySelector('textarea[data-chat-input]')?.value || ''), null, { timeout: 5000 });
    assert.equal((await called(page, 'sendMessage')).length, sentBefore, 'Ask PAI is a draft, not an auto-send');

    // Vault, About you: facts read as plain rows; confirm uses the exact digest.
    await go('/student?view=profile');
    await page.getByRole('heading', { name: 'About you', exact: true }).waitFor();
    await page.getByRole('button', { name: /^Show source and actions for Name/ }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    const review = await called(page, 'reviewProfileCard');
    assert.equal(review.at(-1).args[1].expected_digest, 'a'.repeat(64));
    assert.equal(review.at(-1).args[1].action, 'confirm');

    // Command menu: Ctrl+K jumps anywhere; "Ask PAI" only fills a draft.
    await page.keyboard.press('Control+k');
    await page.getByRole('dialog').getByPlaceholder(/question for PAI/).fill('Vault Documents');
    await page.getByRole('option', { name: 'Vault · Documents' }).click();
    await page.getByRole('heading', { name: 'Your documents' }).waitFor();
    // Documents: the grid's own upload input is mounted (not lost to a missing
    // header slot), and Recently deleted opens the trash.
    assert.equal(await page.locator('main input[type=file]').count(), 2, 'page and folder upload inputs both exist');
    await page.getByRole('button', { name: /Recently deleted/ }).click();
    await page.getByText('Trash is empty').waitFor();
    const sentBeforeAsk = (await called(page, 'sendMessage')).length;
    await page.getByRole('button', { name: 'Search or ask PAI' }).click();
    await page.getByRole('dialog').getByPlaceholder(/question for PAI/).fill('Can we talk about my options?');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('textarea[data-chat-input]')?.value === 'Can we talk about my options?', null, { timeout: 5000 });
    assert.equal((await called(page, 'sendMessage')).length, sentBeforeAsk, 'asking from the menu is a draft, not a send');

    // The sidebar collapses to a rail and remembers it.
    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Expand sidebar' }).click();
    await page.getByRole('button', { name: 'Collapse sidebar' }).waitFor();

  } finally {
    assert.equal(errors.length, 0, 'flow: ' + errors.join(' | '));
    await context.close();
  }

  // Phone: the account menu lives in the top bar; sign-out needs confirmation.
  const phone = await open(browser, 375, 'dark');
  try {
    const p = phone.page;
    await p.goto(`${ORIGIN}/student?view=profile&theme=dark`);
    await p.getByRole('heading', { level: 1 }).first().waitFor();
    const account = p.getByRole('button', { name: 'Account', exact: true });
    const box = await account.boundingBox();
    assert(box && box.width >= 44 && box.height >= 44 && box.x + box.width <= 375, 'account control is reachable and 44px');
    await account.click();
    await p.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await p.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await p.evaluate(() => sessionStorage.getItem('offline-sign-out')), null, 'cancel keeps the session');
    await account.click();
    await p.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await p.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true }).click();
    await p.waitForURL('**/sign-in');
    assert.equal(await p.evaluate(() => sessionStorage.getItem('offline-sign-out')), 'done');
    // Every phone tab is a 44px target; Settings is in the account menu.
    await p.goto(`${ORIGIN}/student?view=journey&theme=dark`);
    for (const tab of await p.getByRole('navigation').last().getByRole('button').all()) {
      const b = await tab.boundingBox();
      assert(b && b.height >= 44 && b.width >= 44, 'tab bar target is at least 44px');
    }
    assert.equal(await p.getByRole('navigation').last().getByRole('button').count(), 5, 'Overview, PAI, Paths, Journey, Vault');
    // One Settings: on phones it is the gear in the top bar; the account menu
    // holds only sign-out.
    await p.getByRole('button', { name: 'Account', exact: true }).click();
    assert.deepEqual(await p.getByRole('menuitem').allInnerTexts(), ['Sign out'], 'the account menu holds only sign-out; settings and feedback live in Settings');
    await p.keyboard.press('Escape');
    await p.getByRole('button', { name: 'Settings', exact: true }).click();
    await p.getByRole('heading', { name: 'Make this space yours' }).waitFor();
  } finally {
    assert.equal(phone.errors.length, 0, 'phone flow: ' + phone.errors.join(' | '));
    await phone.context.close();
  }
  console.log('Flow: A-K boundaries, Mirror drafts only, consent, no auto-choice/auto-send, digest confirm, phone account and tabs.');
};
