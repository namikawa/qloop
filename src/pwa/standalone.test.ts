import { describe, expect, it } from 'vitest';
import { isIos, shouldShowInstallBanner, type NavigatorLike } from './standalone';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6.6 Mobile/15E148 Safari/604.1';
const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

function nav(overrides: Partial<NavigatorLike>): NavigatorLike {
  return { userAgent: MAC_UA, platform: 'MacIntel', maxTouchPoints: 0, ...overrides };
}

describe('isIos', () => {
  it('iPhone の UA は iOS', () => {
    expect(isIos(nav({ userAgent: IPHONE_UA, platform: 'iPhone', maxTouchPoints: 5 }))).toBe(true);
  });

  it('タッチ対応の MacIntel は iPadOS とみなす', () => {
    expect(isIos(nav({ maxTouchPoints: 5 }))).toBe(true);
  });

  it('タッチ非対応の Mac は iOS ではない', () => {
    expect(isIos(nav({}))).toBe(false);
  });
});

describe('shouldShowInstallBanner', () => {
  const iphone = { userAgent: IPHONE_UA, platform: 'iPhone', maxTouchPoints: 5 };

  it('iOS の Safari のタブで開いたときは出す', () => {
    expect(shouldShowInstallBanner(nav({ ...iphone, standalone: false }))).toBe(true);
  });

  it('standalone が無い iOS の環境でも出す（true でないとき）', () => {
    expect(shouldShowInstallBanner(nav(iphone))).toBe(true);
  });

  it('ホーム画面から起動したときは出さない', () => {
    expect(shouldShowInstallBanner(nav({ ...iphone, standalone: true }))).toBe(false);
  });

  it('iOS 以外では出さない', () => {
    expect(shouldShowInstallBanner(nav({ standalone: false }))).toBe(false);
  });
});
