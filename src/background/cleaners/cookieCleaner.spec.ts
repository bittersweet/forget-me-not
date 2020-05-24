import { BrowsingData, Cookies } from "webextension-polyfill-ts";
import { container } from "tsyringe";
import { whitelistPropertyAccess, mockAssimilate, advanceTime } from "mockzilla";
import { mockEvent, MockzillaEventOf } from "mockzilla-webextension";

import { CookieCleaner } from "./cookieCleaner";
import { quickCookie } from "../../testUtils/quickHelpers";
import { CleanupType } from "../../shared/types";
import { mocks } from "../../testUtils/mocks";
import { mockListenerSet, MockzillaListenerSetOf } from "../../testUtils/mockListenerSet";

const COOKIE_STORE_ID = "mock";

describe("CookieCleaner", () => {
    let cookieCleaner: CookieCleaner;
    let onCookieChanged: MockzillaEventOf<typeof mockBrowser.cookies.onChanged>;
    let snoozeListener: MockzillaListenerSetOf<typeof mocks.snoozeManager.listeners>;

    beforeEach(() => {
        onCookieChanged = mockEvent(mockBrowser.cookies.onChanged);
        snoozeListener = mockListenerSet(mocks.snoozeManager.listeners);
        mocks.incognitoWatcher.mockAllow();
        mocks.tabWatcher.mockAllow();
        mocks.settings.mockAllow();
        mocks.supports.mockAllow();
        mocks.cookieUtils.mockAllow();
        mocks.storeUtils.mockAllow();
        mocks.snoozeManager.mockAllow();
        mocks.ruleManager.mockAllow();

        mocks.snoozeManager.isSnoozing.expect().andReturn(false);
        cookieCleaner = container.resolve(CookieCleaner);
    });

    it("should register onCookieChanged correctly", () => {
        const mock = mockAssimilate(cookieCleaner, "cookieCleaner", {
            mock: ["onCookieChanged"],
            whitelist: [""],
        });
        const changeInfo = {} as any;
        mock.onCookieChanged.expect(changeInfo);
        onCookieChanged.emit(changeInfo);
    });
    it("should register snoozeListener correctly", () => {
        const mock = mockAssimilate(cookieCleaner, "cookieCleaner", {
            mock: ["setSnoozing"],
            whitelist: [""],
        });
        const snoozing = {} as any;
        mock.setSnoozing.expect(snoozing);
        snoozeListener.emit(snoozing);
    });

    describe("clean", () => {
        const typeSet: BrowsingData.DataTypeSet = {
            cookies: true,
        };
        beforeEach(() => {
            typeSet.cookies = true;
        });

        it.each.boolean("should not do anything if cookies flag is false and %s", async (startup) => {
            typeSet.cookies = false;
            mockAssimilate(cookieCleaner, "cookieCleaner", {
                mock: [],
                whitelist: ["cleanCookiesWithRulesNow", "clean"],
            });
            await cookieCleaner.clean(typeSet, startup);
            expect(typeSet.cookies).toBe(false);
        });
        it.each.boolean(
            "should not do anything if cookies flag is true and %s with respective setting of false",
            async (startup) => {
                mockAssimilate(cookieCleaner, "cookieCleaner", {
                    mock: [],
                    whitelist: ["cleanCookiesWithRulesNow", "clean", "settings"],
                });
                mocks.settings.get
                    .expect(startup ? "startup.cookies.applyRules" : "cleanAll.cookies.applyRules")
                    .andReturn(false);
                await cookieCleaner.clean(typeSet, startup);
                expect(typeSet.cookies).toBe(true);
            }
        );
        it.each.boolean(
            "should call cleanCookiesWithRulesNow if cookies flag is true and %s with respective setting of true",
            async (startup, protectOpenDomains) => {
                const mock = mockAssimilate(cookieCleaner, "cookieCleaner", {
                    mock: ["cleanCookiesWithRulesNow"],
                    whitelist: ["cleanCookiesWithRulesNow", "clean", "settings"],
                });
                mocks.settings.get
                    .expect(startup ? "startup.cookies.applyRules" : "cleanAll.cookies.applyRules")
                    .andReturn(true);
                if (!startup) mocks.settings.get.expect("cleanAll.protectOpenDomains").andReturn(protectOpenDomains);
                mock.cleanCookiesWithRulesNow.expect(startup, startup || protectOpenDomains);
                await cookieCleaner.clean(typeSet, startup);
                expect(typeSet.cookies).toBe(false);
            }
        );
    });

    describe("cleanDomain", () => {
        it("should delegate to cleanDomainInternal", async () => {
            const mock = mockAssimilate(cookieCleaner, "cookieCleaner", {
                mock: ["cleanDomainInternal"],
                whitelist: ["cleanDomain"],
            });
            mock.cleanDomainInternal.expect(COOKIE_STORE_ID, "some-domain.com", true);
            await cookieCleaner.cleanDomain(COOKIE_STORE_ID, "some-domain.com");
        });
    });

    describe("cleanDomainOnLeave", () => {
        it("should not do anything if domainLeave.enabled = false", async () => {
            mockAssimilate(cookieCleaner, "cookieCleaner", {
                mock: [],
                whitelist: ["cleanDomainOnLeave", "settings"],
            });
            mocks.settings.get.expect("domainLeave.enabled").andReturn(false); // domainLeave.cookies
            await cookieCleaner.cleanDomainOnLeave(COOKIE_STORE_ID, "some-domain.com");
        });
        it("should not do anything if domainLeave.enabled = true, but domainLeave.cookies = false", async () => {
            mockAssimilate(cookieCleaner, "cookieCleaner", {
                mock: [],
                whitelist: ["cleanDomainOnLeave", "settings"],
            });
            mocks.settings.get.expect("domainLeave.enabled").andReturn(true);
            mocks.settings.get.expect("domainLeave.cookies").andReturn(false);
            await cookieCleaner.cleanDomainOnLeave(COOKIE_STORE_ID, "some-domain.com");
        });
        it("should call cleanDomainInternal if domainLeave.enabled = true, but domainLeave.cookies = true", async () => {
            const mock = mockAssimilate(cookieCleaner, "cookieCleaner", {
                mock: ["cleanDomainInternal"],
                whitelist: ["cleanDomainOnLeave", "settings"],
            });
            mock.cleanDomainInternal.expect(COOKIE_STORE_ID, "some-domain.com", false).andResolve();
            mocks.settings.get.expect("domainLeave.enabled").andReturn(true);
            mocks.settings.get.expect("domainLeave.cookies").andReturn(true);
            await cookieCleaner.cleanDomainOnLeave(COOKIE_STORE_ID, "some-domain.com");
        });
    });

    describe("cleanDomainInternal", () => {
        function prepareCleanDomainInternal(ignoreRules: boolean) {
            const removeCookies = jest.fn();
            cookieCleaner["removeCookies"] = removeCookies;
            cookieCleaner["cleanDomainInternal"](COOKIE_STORE_ID, "www.some-domain.com", ignoreRules);
            expect(removeCookies.mock.calls).toEqual([[COOKIE_STORE_ID, expect.anything()]]);
            return removeCookies.mock.calls[0][1] as Parameters<CookieCleaner["removeCookies"]>[1];
        }
        function prepareShouldPurgeExpiredCookie(shouldPurge: boolean) {
            const spy = jest.fn(() => shouldPurge);
            cookieCleaner["shouldPurgeExpiredCookie"] = spy;
            return spy;
        }
        describe("callback with shouldPurgeExpiredCookie=true", () => {
            it.each.boolean("should return true with %s", (ignoreRules) => {
                const callback = prepareCleanDomainInternal(ignoreRules);
                const cookie = quickCookie("some-domain.com", "hello", "", COOKIE_STORE_ID, "");
                const shouldPurgeExpiredCookie = prepareShouldPurgeExpiredCookie(true);
                expect(callback(cookie)).toBe(true);
                expect(shouldPurgeExpiredCookie.mock.calls).toEqual([[cookie]]);
            });
        });
        describe("callback with shouldPurgeExpiredCookie=false", () => {
            describe.each([
                [true, false, true],
                [false, true, false],
                [false, false, true],
            ])("with ignoreRules=%j and isCookieAllowed=%j", (ignoreRules, isCookieAllowed, result) => {
                function prepareIsCookieAllowed() {
                    const spy = jest.fn(() => isCookieAllowed);
                    cookieCleaner["isCookieAllowed"] = spy;
                    return spy;
                }
                function validateIsCookieAllowedSpy(spy: jest.Mock<boolean, []>, cookie: Cookies.Cookie) {
                    if (ignoreRules) expect(spy).not.toHaveBeenCalled();
                    else expect(spy.mock.calls).toEqual([[cookie, false, true, true]]);
                }
                it(`should return ${result} with a matching firstPartyDomain`, () => {
                    const callback = prepareCleanDomainInternal(ignoreRules);
                    const cookie = quickCookie("some-domain.com", "hello", "", COOKIE_STORE_ID, "some-domain.com");
                    const shouldPurgeExpiredCookie = prepareShouldPurgeExpiredCookie(false);
                    const isCookieAllowedSpy = prepareIsCookieAllowed();
                    expect(callback(cookie)).toBe(result);
                    expect(shouldPurgeExpiredCookie.mock.calls).toEqual([[cookie]]);
                    validateIsCookieAllowedSpy(isCookieAllowedSpy, cookie);
                });
                it("should return false with no matching firstPartyDomain", () => {
                    const callback = prepareCleanDomainInternal(ignoreRules);
                    const cookie = quickCookie(
                        "some-domain.com",
                        "hello",
                        "",
                        COOKIE_STORE_ID,
                        "some-other-domain.com"
                    );
                    const shouldPurgeExpiredCookie = prepareShouldPurgeExpiredCookie(false);
                    const isCookieAllowedSpy = prepareIsCookieAllowed();
                    expect(callback(cookie)).toBe(false);
                    expect(shouldPurgeExpiredCookie.mock.calls).toEqual([[cookie]]);
                    expect(isCookieAllowedSpy).not.toHaveBeenCalled();
                });
                it(`should return ${result} with a matching domain->firstPartyDomain`, () => {
                    const callback = prepareCleanDomainInternal(ignoreRules);
                    const cookie = quickCookie("xxx.some-domain.com", "hello", "", COOKIE_STORE_ID, "");
                    const shouldPurgeExpiredCookie = prepareShouldPurgeExpiredCookie(false);
                    const isCookieAllowedSpy = prepareIsCookieAllowed();
                    expect(callback(cookie)).toBe(result);
                    expect(shouldPurgeExpiredCookie.mock.calls).toEqual([[cookie]]);
                    validateIsCookieAllowedSpy(isCookieAllowedSpy, cookie);
                });
                it("should return false with no matching domain->firstPartyDomain", () => {
                    const callback = prepareCleanDomainInternal(ignoreRules);
                    const cookie = quickCookie("xxx.some-other-domain.com", "hello", "", COOKIE_STORE_ID, "");
                    const shouldPurgeExpiredCookie = prepareShouldPurgeExpiredCookie(false);
                    const isCookieAllowedSpy = prepareIsCookieAllowed();
                    expect(callback(cookie)).toBe(false);
                    expect(shouldPurgeExpiredCookie.mock.calls).toEqual([[cookie]]);
                    expect(isCookieAllowedSpy).not.toHaveBeenCalled();
                });
            });
        });
    });

    describe("setSnoozing", () => {
        describe("with snoozing=true", () => {
            it("does nothing", async () => {
                whitelistPropertyAccess(cookieCleaner, "setSnoozing", "snoozing");
                await cookieCleaner.setSnoozing(true);
                expect(cookieCleaner["snoozing"]).toBe(true);
            });
        });
        describe("with snoozing=false", () => {
            const cookie1 = quickCookie("some-domain.com", "name1", "", COOKIE_STORE_ID, "");
            const cookie2 = quickCookie("some-domain.com", "name2", "", COOKIE_STORE_ID, "");
            const cookie3 = quickCookie("some-domain.com", "name3", "", COOKIE_STORE_ID, "");
            const cookie4 = quickCookie("some-domain.com", "name4", "/unwanted", COOKIE_STORE_ID, "");
            describe.each.boolean("with %s", (cleanThirdPartyCookiesEnabled, cleanThirdPartyCookiesBeforeCreation) => {
                const parts = [];
                cleanThirdPartyCookiesEnabled && parts.push("snoozed thirdparty cookies");
                cleanThirdPartyCookiesBeforeCreation && parts.push("snoozed instantly cookies");
                parts.length === 0 && parts.push("nothing, but still empties the arrays");
                it(`removes ${parts.join(" and ")}`, async () => {
                    cookieCleaner["snoozedThirdpartyCookies"].push(cookie1, cookie2);
                    cookieCleaner["snoozedInstantlyCookies"].push(cookie3, cookie4);
                    const mock = mockAssimilate(cookieCleaner, "cookieCleaner", {
                        mock: ["removeCookieIfThirdparty", "isUnwantedThirdPartyCookie"],
                        whitelist: [
                            "settings",
                            "cookieUtils",
                            "snoozing",
                            "setSnoozing",
                            "snoozedThirdpartyCookies",
                            "snoozedInstantlyCookies",
                        ],
                    });

                    mocks.settings.get
                        .expect("cleanThirdPartyCookies.enabled")
                        .andReturn(cleanThirdPartyCookiesEnabled);
                    if (cleanThirdPartyCookiesEnabled) {
                        mock.removeCookieIfThirdparty.expect(cookie1).andResolve();
                        mock.removeCookieIfThirdparty.expect(cookie2).andResolve();
                    }
                    mocks.settings.get
                        .expect("cleanThirdPartyCookies.beforeCreation")
                        .andReturn(cleanThirdPartyCookiesBeforeCreation);
                    if (cleanThirdPartyCookiesBeforeCreation) {
                        mock.isUnwantedThirdPartyCookie.expect(cookie3).andReturn(false);
                        mock.isUnwantedThirdPartyCookie.expect(cookie4).andReturn(true);
                        mocks.cookieUtils.removeCookie.expect(cookie4).andResolve({} as any);
                    }

                    await cookieCleaner.setSnoozing(false);

                    expect(cookieCleaner["snoozedThirdpartyCookies"]).toHaveLength(0);
                    expect(cookieCleaner["snoozedInstantlyCookies"]).toHaveLength(0);
                    expect(cookieCleaner["snoozing"]).toBe(false);
                });
            });
        });
    });

    describe("cleanCookiesWithRulesNow", () => {
        const cookie = quickCookie("some-domain.com", "name1", "", COOKIE_STORE_ID, "");

        it.each.boolean("should remove unwanted cookies with %s", async (ignoreStartupType, protectOpenDomains) => {
            mocks.storeUtils.getAllCookieStoreIds.expect().andResolve([COOKIE_STORE_ID, "another-mock-store"]);
            const removeCookies = jest.fn();
            cookieCleaner["removeCookies"] = removeCookies;
            const shouldPurgeExpiredCookie = jest.fn();
            cookieCleaner["shouldPurgeExpiredCookie"] = shouldPurgeExpiredCookie;
            const isCookieAllowed = jest.fn();
            cookieCleaner["isCookieAllowed"] = isCookieAllowed;

            await cookieCleaner["cleanCookiesWithRulesNow"](ignoreStartupType, protectOpenDomains);

            expect(removeCookies.mock.calls).toEqual([
                [COOKIE_STORE_ID, expect.anything()],
                ["another-mock-store", expect.anything()],
            ]);
            const callback = removeCookies.mock.calls[0][1] as (cookie: Cookies.Cookie) => boolean;

            shouldPurgeExpiredCookie.mockReturnValueOnce(false);
            isCookieAllowed.mockReturnValueOnce(true);
            expect(callback(cookie)).toBe(false);
            expect(shouldPurgeExpiredCookie.mock.calls).toEqual([[cookie]]);
            expect(isCookieAllowed.mock.calls).toEqual([[cookie, ignoreStartupType, protectOpenDomains, true]]);
            shouldPurgeExpiredCookie.mockReset();
            isCookieAllowed.mockReset();

            shouldPurgeExpiredCookie.mockReturnValueOnce(true);
            expect(callback(cookie)).toBe(true);
            expect(shouldPurgeExpiredCookie.mock.calls).toEqual([[cookie]]);
            expect(isCookieAllowed).not.toHaveBeenCalled();
            shouldPurgeExpiredCookie.mockReset();

            shouldPurgeExpiredCookie.mockReturnValueOnce(false);
            isCookieAllowed.mockReturnValueOnce(false);
            expect(callback(cookie)).toBe(true);
            expect(shouldPurgeExpiredCookie.mock.calls).toEqual([[cookie]]);
            expect(isCookieAllowed.mock.calls).toEqual([[cookie, ignoreStartupType, protectOpenDomains, true]]);
        });
    });

    describe("isUnwantedThirdPartyCookie", () => {
        const cookie = quickCookie("some-domain.com", "name1", "", COOKIE_STORE_ID, "");

        describe.each.boolean("with %s", (hasStore, isThirdparty) => {
            const result = !hasStore && isThirdparty;
            it(`should return ${result}`, () => {
                const mock = mockAssimilate(cookieCleaner, "cookieCleaner", {
                    mock: ["isThirdpartyCookie"],
                });

                if (!hasStore) mock.isThirdpartyCookie.expect(cookie).andReturn(isThirdparty);
                mocks.incognitoWatcher.hasCookieStore.expect(COOKIE_STORE_ID).andReturn(hasStore);

                expect(cookieCleaner["isUnwantedThirdPartyCookie"](cookie)).toBe(result);
            });
        });
    });

    describe("shouldRemoveCookieInstantly", () => {
        const cookie = quickCookie(".www.some-domain.com", "name1", "", COOKIE_STORE_ID, "");
        describe.each([
            [false, false],
            [true, false],
            [false, true],
        ])("with instantly.enabled=%j and instantly.cookies=%j", (instantlyEnabled, cookiesEnabled) => {
            it("returns false", () => {
                mocks.settings.get.expect("instantly.enabled").andReturn(instantlyEnabled);
                if (instantlyEnabled) mocks.settings.get.expect("instantly.cookies").andReturn(cookiesEnabled);
                expect(cookieCleaner["shouldRemoveCookieInstantly"](cookie)).toBe(false);
            });
        });
        describe("with instantly.enabled=true and instantly.cookies=true", () => {
            it.each([
                [false, CleanupType.LEAVE],
                [false, CleanupType.NEVER],
                [false, CleanupType.STARTUP],
                [true, CleanupType.INSTANTLY],
            ])("returns %j for cleanupType=%i", (result, cleanupType) => {
                mocks.settings.get.expect("instantly.enabled").andReturn(true);
                mocks.settings.get.expect("instantly.cookies").andReturn(true);
                mocks.ruleManager.getCleanupTypeFor
                    .expect("www.some-domain.com", COOKIE_STORE_ID, "name1")
                    .andReturn(cleanupType);
                expect(cookieCleaner["shouldRemoveCookieInstantly"](cookie)).toBe(result);
            });
        });
    });

    describe("onCookieChanged", () => {
        const cookie = quickCookie(".www.some-domain.com", "name1", "", COOKIE_STORE_ID, "");
        const changeInfo: Cookies.OnChangedChangeInfoType = {
            removed: false,
            cookie,
            cause: "explicit",
        };
        describe.each([
            [true, true],
            [true, false],
            [false, true],
        ])("with incognito=%j and removed=%j", (incognito, removed) => {
            it("does nothing", async () => {
                changeInfo.removed = removed;
                if (!removed) mocks.incognitoWatcher.hasCookieStore.expect(COOKIE_STORE_ID).andReturn(incognito);
                whitelistPropertyAccess(cookieCleaner, "onCookieChanged", "incognitoWatcher");
                await cookieCleaner["onCookieChanged"](changeInfo);
            });
        });
        describe("with incognito=false and removed=false", () => {
            beforeEach(() => {
                changeInfo.removed = false;
                mocks.incognitoWatcher.hasCookieStore.expect(COOKIE_STORE_ID).andReturn(false);
            });
            it("delegates the call to onCookieAddedSnoozing with snoozing=true", async () => {
                cookieCleaner["snoozing"] = true;
                const mock = mockAssimilate(cookieCleaner, "cookieCleaner", {
                    mock: ["onCookieAddedSnoozing"],
                    whitelist: ["snoozing", "incognitoWatcher", "onCookieChanged"],
                });
                mock.onCookieAddedSnoozing.expect(cookie).andResolve();
                await cookieCleaner["onCookieChanged"](changeInfo);
            });
            it("delegates the call to onCookieAddedAwake with snoozing=false", async () => {
                cookieCleaner["snoozing"] = false;

                const mock = mockAssimilate(cookieCleaner, "cookieCleaner", {
                    mock: ["onCookieAddedAwake"],
                    whitelist: ["snoozing", "incognitoWatcher", "onCookieChanged"],
                });
                mock.onCookieAddedAwake.expect(cookie).andResolve();

                await cookieCleaner["onCookieChanged"](changeInfo);
            });
        });
    });

    describe("onCookieAddedSnoozing", () => {
        const cookie = quickCookie("www.some-domain.com", "name1", "", COOKIE_STORE_ID, "");
        describe("with isUnwantedThirdPartyCookie=false", () => {
            it("does nothing", async () => {
                const mock = mockAssimilate(cookieCleaner, "cookieCleaner", {
                    mock: ["isUnwantedThirdPartyCookie"],
                    whitelist: ["onCookieAddedSnoozing"],
                });
                mock.isUnwantedThirdPartyCookie.expect(cookie).andReturn(false);

                await cookieCleaner["onCookieAddedSnoozing"](cookie);
            });
        });

        describe("with isUnwantedThirdPartyCookie=true", () => {
            it("does nothing with cleanThirdPartyCookies.beforeCreation=false and cleanThirdPartyCookies.enabled=false", async () => {
                const mock = mockAssimilate(cookieCleaner, "cookieCleaner", {
                    mock: ["isUnwantedThirdPartyCookie"],
                    whitelist: ["onCookieAddedSnoozing", "settings"],
                });
                mock.isUnwantedThirdPartyCookie.expect(cookie).andReturn(true);
                mocks.settings.get.expect("cleanThirdPartyCookies.beforeCreation").andReturn(false);
                mocks.settings.get.expect("cleanThirdPartyCookies.enabled").andReturn(false);

                await cookieCleaner["onCookieAddedSnoozing"](cookie);
            });
            it("adds the cookie to snoozedInstantlyCookies with cleanThirdPartyCookies.beforeCreation=true", async () => {
                const mock = mockAssimilate(cookieCleaner, "cookieCleaner", {
                    mock: ["isUnwantedThirdPartyCookie"],
                    whitelist: ["onCookieAddedSnoozing", "settings", "snoozedInstantlyCookies"],
                });
                mock.isUnwantedThirdPartyCookie.expect(cookie).andReturn(true);
                mocks.settings.get.expect("cleanThirdPartyCookies.beforeCreation").andReturn(true);

                await cookieCleaner["onCookieAddedSnoozing"](cookie);
                expect(cookieCleaner["snoozedInstantlyCookies"]).toEqual([cookie]);
            });
            it("schedules the cookie to be removed with cleanThirdPartyCookies.beforeCreation=false and cleanThirdPartyCookies.enabled=true", async () => {
                const mock = mockAssimilate(cookieCleaner, "cookieCleaner", {
                    mock: ["isUnwantedThirdPartyCookie", "removeCookieIfThirdparty"],
                    whitelist: ["onCookieAddedSnoozing", "settings"],
                });
                mock.isUnwantedThirdPartyCookie.expect(cookie).andReturn(true);
                mock.removeCookieIfThirdparty.expect(cookie).andResolve();

                mocks.settings.get.expect("cleanThirdPartyCookies.beforeCreation").andReturn(false);
                mocks.settings.get.expect("cleanThirdPartyCookies.enabled").andReturn(true);

                await cookieCleaner["onCookieAddedSnoozing"](cookie);
            });
        });
    });

    describe("onCookieAddedAwake", () => {
        const cookie = quickCookie("www.some-domain.com", "name1", "", COOKIE_STORE_ID, "");
        it("does nothing with shouldRemoveCookieInstantly=false and cleanThirdPartyCookies.enabled=false", async () => {
            const mock = mockAssimilate(cookieCleaner, "cookieCleaner", {
                mock: ["shouldRemoveCookieInstantly"],
                whitelist: ["onCookieAddedAwake", "settings"],
            });
            mock.shouldRemoveCookieInstantly.expect(cookie).andReturn(false);
            mocks.settings.get.expect("cleanThirdPartyCookies.enabled").andReturn(false);

            await cookieCleaner["onCookieAddedAwake"](cookie);
        });
        it("removes the cookie with shouldRemoveCookieInstantly=true", async () => {
            const mock = mockAssimilate(cookieCleaner, "cookieCleaner", {
                mock: ["shouldRemoveCookieInstantly"],
                whitelist: ["onCookieAddedAwake", "cookieUtils"],
            });
            mock.shouldRemoveCookieInstantly.expect(cookie).andReturn(true);
            mocks.cookieUtils.removeCookie.expect(cookie).andResolve({} as any);

            await cookieCleaner["onCookieAddedAwake"](cookie);
        });
        it("delegates to removeCookieIfThirdparty with shouldRemoveCookieInstantly=false and cleanThirdPartyCookies.enabled=true", async () => {
            const mock = mockAssimilate(cookieCleaner, "cookieCleaner", {
                mock: ["shouldRemoveCookieInstantly", "removeCookieIfThirdparty"],
                whitelist: ["onCookieAddedAwake", "settings"],
            });
            mock.shouldRemoveCookieInstantly.expect(cookie).andReturn(false);
            mock.removeCookieIfThirdparty.expect(cookie).andResolve();

            mocks.settings.get.expect("cleanThirdPartyCookies.enabled").andReturn(true);

            await cookieCleaner["onCookieAddedAwake"](cookie);
        });
    });

    describe("removeCookieIfThirdparty", () => {
        const cookie = quickCookie("www.some-domain.com", "name1", "", COOKIE_STORE_ID, "");
        it("does nothing with isUnwantedThirdPartyCookie=false", async () => {
            const mock = mockAssimilate(cookieCleaner, "cookieCleaner", {
                mock: ["isUnwantedThirdPartyCookie"],
                whitelist: ["removeCookieIfThirdparty"],
            });
            mock.isUnwantedThirdPartyCookie.expect(cookie).andReturn(false);

            await cookieCleaner["removeCookieIfThirdparty"](cookie);
        });
        it("delegates to scheduleThirdpartyCookieRemove with isUnwantedThirdPartyCookie=true", async () => {
            const mock = mockAssimilate(cookieCleaner, "cookieCleaner", {
                mock: ["isUnwantedThirdPartyCookie", "scheduleThirdpartyCookieRemove"],
                whitelist: ["removeCookieIfThirdparty"],
            });
            mock.isUnwantedThirdPartyCookie.expect(cookie).andReturn(true);
            mock.scheduleThirdpartyCookieRemove.expect(cookie).andResolve();

            await cookieCleaner["removeCookieIfThirdparty"](cookie);
        });
    });

    describe("scheduleThirdpartyCookieRemove", () => {
        describe.each([[0], [-10], [42]])("with delay=%i", (delay) => {
            describe("with snoozing=true", () => {
                it("should push the cookie to snoozedThirdpartyCookies", async () => {
                    const firstCookie = {} as any;
                    cookieCleaner["snoozedThirdpartyCookies"].push(firstCookie);
                    cookieCleaner["snoozing"] = true;
                    whitelistPropertyAccess(
                        cookieCleaner,
                        "snoozedThirdpartyCookies",
                        "scheduleThirdpartyCookieRemove",
                        "snoozing"
                    );
                    const cookie = {} as any;
                    await cookieCleaner["scheduleThirdpartyCookieRemove"](cookie);
                    expect(cookieCleaner["snoozedThirdpartyCookies"]).toHaveSameOrderedMembers([firstCookie, cookie]);
                });
            });
            describe("with snoozing=false", () => {
                if (delay > 0) {
                    it("should call delayedScheduleThirdpartyCookieRemove delayed", async () => {
                        cookieCleaner["snoozing"] = false;
                        const mock = mockAssimilate(cookieCleaner, "cookieCleaner", {
                            mock: ["delayedScheduleThirdpartyCookieRemove"],
                            whitelist: ["snoozing", "settings", "scheduleThirdpartyCookieRemove"],
                        });
                        const cookie = {} as any;
                        mocks.settings.get.expect("cleanThirdPartyCookies.delay").andReturn(delay);
                        await cookieCleaner["scheduleThirdpartyCookieRemove"](cookie);
                        advanceTime(delay * 1000 - 1);
                        mock.delayedScheduleThirdpartyCookieRemove.expect(cookie).andResolve();
                        advanceTime(1);
                    });
                } else {
                    it("should call delayedScheduleThirdpartyCookieRemove immediately", async () => {
                        cookieCleaner["snoozing"] = false;
                        const mock = mockAssimilate(cookieCleaner, "cookieCleaner", {
                            mock: ["delayedScheduleThirdpartyCookieRemove"],
                            whitelist: ["snoozing", "settings", "scheduleThirdpartyCookieRemove"],
                        });
                        const cookie = {} as any;
                        mocks.settings.get.expect("cleanThirdPartyCookies.delay").andReturn(delay);
                        mock.delayedScheduleThirdpartyCookieRemove.expect(cookie).andResolve();
                        await cookieCleaner["scheduleThirdpartyCookieRemove"](cookie);
                    });
                }
            });
        });
    });

    describe("delayedScheduleThirdpartyCookieRemove", () => {
        describe.each.boolean("with %s", (isThirdpartyCookie, isCookieAllowed) => {
            describe("with snoozing=true", () => {
                it("should push the cookie to snoozedThirdpartyCookies", async () => {
                    const firstCookie = {} as any;
                    cookieCleaner["snoozedThirdpartyCookies"].push(firstCookie);
                    cookieCleaner["snoozing"] = true;
                    whitelistPropertyAccess(
                        cookieCleaner,
                        "snoozedThirdpartyCookies",
                        "delayedScheduleThirdpartyCookieRemove",
                        "snoozing"
                    );
                    const cookie = {} as any;
                    await cookieCleaner["delayedScheduleThirdpartyCookieRemove"](cookie);
                    expect(cookieCleaner["snoozedThirdpartyCookies"]).toHaveSameOrderedMembers([firstCookie, cookie]);
                });
            });
            describe("with snoozing=false", () => {
                const remove = isThirdpartyCookie && !isCookieAllowed;
                it(`should ${remove ? "remove" : "not remove"} the cookie`, async () => {
                    cookieCleaner["snoozing"] = false;
                    const mock = mockAssimilate(cookieCleaner, "cookieCleaner", {
                        mock: ["isThirdpartyCookie", "isCookieAllowed"],
                        whitelist: ["snoozing", "cookieUtils", "delayedScheduleThirdpartyCookieRemove"],
                    });
                    const cookie = {} as any;
                    mock.isThirdpartyCookie.expect(cookie).andReturn(isThirdpartyCookie);
                    if (isThirdpartyCookie)
                        mock.isCookieAllowed.expect(cookie, false, false, false).andReturn(isCookieAllowed);
                    if (remove) mocks.cookieUtils.removeCookie.expect(cookie).andResolve({} as any);
                    await cookieCleaner["delayedScheduleThirdpartyCookieRemove"](cookie);
                });
            });
        });
    });

    describe("isThirdpartyCookie", () => {
        describe("with firstPartyDomain on cookie", () => {
            it("returns false if firstPartyDomain matches", () => {
                const cookie = quickCookie("www.some-domain.com", "name1", "", COOKIE_STORE_ID, "some-domain.com");
                whitelistPropertyAccess(cookieCleaner, "isThirdpartyCookie");

                expect(cookieCleaner["isThirdpartyCookie"](cookie)).toBe(false);
            });
            it("returns true if firstPartyDomain does not match", () => {
                const cookie = quickCookie("www.other-domain.com", "name1", "", COOKIE_STORE_ID, "some-domain.com");
                whitelistPropertyAccess(cookieCleaner, "isThirdpartyCookie");

                expect(cookieCleaner["isThirdpartyCookie"](cookie)).toBe(true);
            });
        });
        describe("without firstPartyDomain on cookie", () => {
            const cookie = quickCookie("www.some-domain.com", "name1", "", COOKIE_STORE_ID, "");
            it("returns true if cookieStoreContainsDomainFP returns false", () => {
                whitelistPropertyAccess(cookieCleaner, "tabWatcher", "isThirdpartyCookie");
                mocks.tabWatcher.cookieStoreContainsDomainFP
                    .expect(cookie.storeId, "some-domain.com", false)
                    .andReturn(false);

                expect(cookieCleaner["isThirdpartyCookie"](cookie)).toBe(true);
            });
            it("returns false if cookieStoreContainsDomainFP returns true", () => {
                whitelistPropertyAccess(cookieCleaner, "tabWatcher", "isThirdpartyCookie");
                mocks.tabWatcher.cookieStoreContainsDomainFP
                    .expect(cookie.storeId, "some-domain.com", false)
                    .andReturn(true);

                expect(cookieCleaner["isThirdpartyCookie"](cookie)).toBe(false);
            });
        });
    });

    describe("removeCookies", () => {
        const storeId = COOKIE_STORE_ID;
        const cookie1 = quickCookie("www.some-domain.com", "name1", "", COOKIE_STORE_ID, "some-domain.com");
        const cookie2 = quickCookie("www.some-domain.com", "name2", "", COOKIE_STORE_ID, "some-domain.com");
        const cookie3 = quickCookie("www.some-domain.com", "name3", "", COOKIE_STORE_ID, "some-domain.com");
        const cookie4 = quickCookie("www.some-domain.com", "name4", "", COOKIE_STORE_ID, "some-domain.com");
        const allCookies = [cookie1, cookie2, cookie3, cookie4];
        const testCookies = [cookie1, cookie3];
        it.each([
            [false, { storeId }],
            [true, { storeId, firstPartyDomain: null }],
        ])(
            "removes cookies where test returns true with firstPartyIsolation=%j",
            async (firstPartyIsolation, expectedDetails) => {
                mocks.supports.firstPartyIsolation.mock(firstPartyIsolation);
                expect(cookieCleaner["supports"].firstPartyIsolation).toBe(firstPartyIsolation);
                mockBrowser.cookies.getAll.expect(expectedDetails).andResolve(allCookies);
                testCookies.forEach((cookie) => mocks.cookieUtils.removeCookie.expect(cookie).andResolve({} as any));
                await cookieCleaner["removeCookies"](storeId, (cookie) => testCookies.includes(cookie));
            }
        );
    });

    describe("shouldPurgeExpiredCookie", () => {
        const expired = Date.now() / 1000;
        const notExpired = (Date.now() + 24 * 60 * 60 * 1000) / 1000;
        it.each([
            [false, false, "an expired cookie", expired],
            [true, true, "an expired cookie", expired],
            [false, true, "an unexpired cookie", notExpired],
        ])(
            "should return %j with purgeExpiredCookies=%j and with %s",
            (result, purgeExpiredCookies, _, expirationDate) => {
                const cookie = quickCookie("domain.com", "name", "path", COOKIE_STORE_ID, "");
                cookie.expirationDate = expirationDate;
                mocks.settings.get.expect("purgeExpiredCookies").andReturn(purgeExpiredCookies);
                expect(cookieCleaner["shouldPurgeExpiredCookie"](cookie)).toBe(result);
            }
        );
    });

    describe("isCookieAllowed", () => {
        const cookie = quickCookie(".www.some-domain.com", "name1", "", COOKIE_STORE_ID, "some-domain.com");

        describe.each([
            [CleanupType.NEVER, true],
            [CleanupType.INSTANTLY, false],
        ])("with cleanupType=%i", (cleanupType, expectedReturnType) => {
            it.each.boolean(
                `should return ${expectedReturnType} for %s`,
                (ignoreStartupType: boolean, protectOpenDomains: boolean, protectSubFrames: boolean) => {
                    mocks.ruleManager.getCleanupTypeFor
                        .expect("www.some-domain.com", cookie.storeId, cookie.name)
                        .andReturn(cleanupType);
                    whitelistPropertyAccess(cookieCleaner, "ruleManager", "isCookieAllowed");

                    expect(
                        cookieCleaner["isCookieAllowed"](
                            cookie,
                            ignoreStartupType,
                            protectOpenDomains,
                            protectSubFrames
                        )
                    ).toBe(expectedReturnType);
                }
            );
        });

        describe("with CleanupType.STARTUP and ignoreStartupType=false", () => {
            it.each.boolean("should return true for %s", (protectOpenDomains: boolean, protectSubFrames: boolean) => {
                mocks.ruleManager.getCleanupTypeFor
                    .expect("www.some-domain.com", cookie.storeId, cookie.name)
                    .andReturn(CleanupType.STARTUP);
                whitelistPropertyAccess(cookieCleaner, "ruleManager", "isCookieAllowed");

                expect(cookieCleaner["isCookieAllowed"](cookie, false, protectOpenDomains, protectSubFrames)).toBe(
                    true
                );
            });
        });

        describe.each([
            [CleanupType.STARTUP, true],
            [CleanupType.LEAVE, true],
            [CleanupType.LEAVE, false],
        ])("with cleanupType=%i and ignoreStartupType=%j", (cleanupType, ignoreStartupType) => {
            describe.each.boolean("with protectOpenDomains=false, %s", (protectSubFrames: boolean) => {
                it("should return false", () => {
                    mocks.ruleManager.getCleanupTypeFor
                        .expect("www.some-domain.com", cookie.storeId, cookie.name)
                        .andReturn(cleanupType);
                    whitelistPropertyAccess(cookieCleaner, "ruleManager", "isCookieAllowed");

                    expect(cookieCleaner["isCookieAllowed"](cookie, ignoreStartupType, false, protectSubFrames)).toBe(
                        false
                    );
                });
            });
            describe.each.boolean("with protectOpenDomains=true, %s", (protectSubFrames: boolean) => {
                describe.each([[""], ["some-other-domain.com"]])(
                    "with cookie.firstPartyDomain=%j",
                    (firstPartyDomain) => {
                        const cookie2 = quickCookie(
                            ".www.some-domain.com",
                            "name1",
                            "",
                            COOKIE_STORE_ID,
                            firstPartyDomain
                        );
                        it.each([[true], [false]])(
                            "should return %j if cookieStoreContainsDomainFP does",
                            (expectedReturn) => {
                                mocks.ruleManager.getCleanupTypeFor
                                    .expect("www.some-domain.com", cookie2.storeId, cookie2.name)
                                    .andReturn(cleanupType);
                                whitelistPropertyAccess(cookieCleaner, "ruleManager", "tabWatcher", "isCookieAllowed");
                                const expectedFirstPartyDomain = firstPartyDomain || "some-domain.com";
                                mocks.tabWatcher.cookieStoreContainsDomainFP
                                    .expect(COOKIE_STORE_ID, expectedFirstPartyDomain, protectSubFrames)
                                    .andReturn(expectedReturn);

                                expect(
                                    cookieCleaner["isCookieAllowed"](cookie2, ignoreStartupType, true, protectSubFrames)
                                ).toBe(expectedReturn);
                            }
                        );
                    }
                );
            });
        });
    });
});