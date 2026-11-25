/**
 * FRONTEND-051: `DeferredAuthService`, the `AuthService` that loads the real one
 * lazily so the Cognito SDK leaves the entry chunk.
 *
 * The inner service is a plain object of `vi.fn()`s typed as `AuthService`, and
 * the loader is a promise this file resolves or rejects by hand, so every case
 * can say exactly when the load finishes relative to the call under test.
 */
import { describe, expect, it, vi } from "vitest";

import { AuthError, type AuthService } from "./AuthService";
import { DeferredAuthService } from "./DeferredAuthService";

type Inner = {
  [K in keyof AuthService]: ReturnType<typeof vi.fn>;
} & AuthService;

function fakeInner(): Inner {
  return {
    signUp: vi.fn(),
    confirmSignUp: vi.fn(),
    resendConfirmationCode: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    forgotPassword: vi.fn(),
    confirmForgotPassword: vi.fn(),
    refreshSession: vi.fn(),
    getIdToken: vi.fn(),
    reauthenticate: vi.fn(),
    emailVerified: vi.fn(),
    requestEmailVerification: vi.fn(),
    confirmEmailVerification: vi.fn(),
  } as Inner;
}

interface Pending {
  promise: Promise<AuthService>;
  resolve: (service: AuthService) => void;
  reject: (error: unknown) => void;
}

function pending(): Pending {
  let resolve!: (service: AuthService) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<AuthService>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let every queued promise callback run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

type AsyncMethod = Exclude<keyof AuthService, "signOut">;

/** Each async method, the arguments a caller passes and the result the inner one answers. */
const CASES: { method: AsyncMethod; args: unknown[]; result: unknown }[] = [
  {
    method: "signUp",
    args: [{ email: "a@example.com", password: "pw-1" }],
    result: { userConfirmed: false },
  },
  {
    method: "confirmSignUp",
    args: [{ email: "a@example.com", code: "123456" }],
    result: undefined,
  },
  {
    method: "resendConfirmationCode",
    args: ["a@example.com"],
    result: undefined,
  },
  {
    method: "signIn",
    args: [{ email: "a@example.com", password: "pw-1" }],
    result: { idToken: "id-token", email: "a@example.com" },
  },
  { method: "forgotPassword", args: ["a@example.com"], result: undefined },
  {
    method: "confirmForgotPassword",
    args: [{ email: "a@example.com", code: "654321", newPassword: "pw-2" }],
    result: undefined,
  },
  {
    method: "refreshSession",
    args: [],
    result: { idToken: "restored", email: "b@example.com" },
  },
  { method: "getIdToken", args: [], result: "current-id-token" },
  { method: "reauthenticate", args: ["pw-3"], result: undefined },
  { method: "emailVerified", args: [], result: true },
  { method: "requestEmailVerification", args: [], result: undefined },
  { method: "confirmEmailVerification", args: ["111222"], result: undefined },
];

describe("DeferredAuthService delegates every async method", () => {
  it("covers all twelve async methods of the interface", () => {
    expect(CASES.map((one) => one.method).sort()).toEqual(
      (Object.keys(fakeInner()) as (keyof AuthService)[])
        .filter((name) => name !== "signOut")
        .sort(),
    );
  });

  it.each(CASES)(
    "$method passes its arguments and resolves to the inner result",
    async (one) => {
      const inner = fakeInner();
      inner[one.method].mockResolvedValue(one.result);
      const service = new DeferredAuthService(() => Promise.resolve(inner));

      const call = (
        service[one.method] as (...args: unknown[]) => Promise<unknown>
      )(...one.args);

      await expect(call).resolves.toBe(one.result);
      expect(inner[one.method]).toHaveBeenCalledTimes(1);
      expect(inner[one.method]).toHaveBeenCalledWith(...one.args);
    },
  );

  it("returns the inner result object itself, not a copy", async () => {
    const inner = fakeInner();
    const session = { idToken: "id-token", email: "a@example.com" };
    inner.signIn.mockResolvedValue(session);
    const service = new DeferredAuthService(() => Promise.resolve(inner));

    await expect(
      service.signIn({ email: "a@example.com", password: "pw" }),
    ).resolves.toBe(session);
  });

  it("delegates a call made while the load is still pending once it resolves", async () => {
    const inner = fakeInner();
    inner.getIdToken.mockResolvedValue("late-token");
    const load = pending();
    const service = new DeferredAuthService(() => load.promise);

    const call = service.getIdToken();
    await settle();
    expect(inner.getIdToken).not.toHaveBeenCalled();

    load.resolve(inner);
    await expect(call).resolves.toBe("late-token");
  });
});

describe("DeferredAuthService loads once, at construction", () => {
  it("calls the loader exactly once on construction, before any method", () => {
    const loader = vi.fn(() => pending().promise);

    new DeferredAuthService(loader);

    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("does not call the loader again while the load is pending or after it resolved", async () => {
    const inner = fakeInner();
    inner.getIdToken.mockResolvedValue(null);
    inner.emailVerified.mockResolvedValue(false);
    const load = pending();
    const loader = vi.fn(() => load.promise);
    const service = new DeferredAuthService(loader);

    const first = service.getIdToken();
    const second = service.emailVerified();
    expect(loader).toHaveBeenCalledTimes(1);

    load.resolve(inner);
    await Promise.all([first, second]);
    await service.getIdToken();
    await service.refreshSession();

    expect(loader).toHaveBeenCalledTimes(1);
  });
});

describe("DeferredAuthService.signOut stays synchronous", () => {
  it("signs out of the loaded service at once, in the same tick, after the load resolved", async () => {
    const inner = fakeInner();
    const service = new DeferredAuthService(() => Promise.resolve(inner));
    await settle();

    const returned = service.signOut();

    expect(returned).toBeUndefined();
    expect(inner.signOut).toHaveBeenCalledTimes(1);
  });

  it("does not throw while the load is pending, and signs out as soon as it resolves", async () => {
    const inner = fakeInner();
    const load = pending();
    const service = new DeferredAuthService(() => load.promise);

    let returned: unknown = "not called";
    expect(() => {
      returned = service.signOut();
    }).not.toThrow();
    expect(returned).toBeUndefined();
    expect(inner.signOut).not.toHaveBeenCalled();

    load.resolve(inner);
    await settle();

    expect(inner.signOut).toHaveBeenCalledTimes(1);
  });

  it("keeps a sign-out made during a failed load for the load that succeeds, before the call that waited on it", async () => {
    const inner = fakeInner();
    const order: string[] = [];
    inner.signOut.mockImplementation(() => order.push("signOut"));
    inner.getIdToken.mockImplementation(() => {
      order.push("getIdToken");
      return Promise.resolve(null);
    });
    const first = pending();
    const loader = vi
      .fn<() => Promise<AuthService>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(inner);
    const service = new DeferredAuthService(loader);

    service.signOut();
    first.reject(new Error("chunk failed to load"));
    await settle();
    expect(inner.signOut).not.toHaveBeenCalled();

    await expect(service.getIdToken()).resolves.toBeNull();

    expect(loader).toHaveBeenCalledTimes(2);
    expect(order).toEqual(["signOut", "getIdToken"]);
  });

  it("does not sign out again on a later call once the pending sign-out ran", async () => {
    const inner = fakeInner();
    inner.getIdToken.mockResolvedValue(null);
    const load = pending();
    const service = new DeferredAuthService(() => load.promise);

    service.signOut();
    load.resolve(inner);
    await settle();
    await service.getIdToken();
    await service.getIdToken();

    expect(inner.signOut).toHaveBeenCalledTimes(1);
  });
});

describe("DeferredAuthService does not cache a failed load", () => {
  it("rejects the waiting calls with the load's error, then retries the loader and delegates", async () => {
    const inner = fakeInner();
    inner.getIdToken.mockResolvedValue("after-retry");
    inner.emailVerified.mockResolvedValue(true);
    const failure = new Error("chunk failed to load");
    const first = pending();
    const loader = vi
      .fn<() => Promise<AuthService>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(inner);
    const service = new DeferredAuthService(loader);

    const waitingA = service.getIdToken();
    const waitingB = service.emailVerified();
    first.reject(failure);

    await expect(waitingA).rejects.toBe(failure);
    await expect(waitingB).rejects.toBe(failure);
    expect(loader).toHaveBeenCalledTimes(1);

    await expect(service.getIdToken()).resolves.toBe("after-retry");
    expect(loader).toHaveBeenCalledTimes(2);
    expect(inner.getIdToken).toHaveBeenCalledTimes(1);

    await expect(service.emailVerified()).resolves.toBe(true);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("does not leave an unhandled rejection when nothing was waiting on a failed load", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      new DeferredAuthService(() => Promise.reject(new Error("offline")));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});

describe("DeferredAuthService passes the inner service's failures through unchanged", () => {
  it("rejects with the inner AuthError itself, not a wrapper", async () => {
    const inner = fakeInner();
    const failure = new AuthError(
      "NotAuthorizedException",
      "Incorrect username or password.",
    );
    inner.signIn.mockRejectedValue(failure);
    const service = new DeferredAuthService(() => Promise.resolve(inner));

    const caught = await service
      .signIn({ email: "a@example.com", password: "wrong" })
      .catch((error: unknown) => error);

    expect(caught).toBe(failure);
    expect(caught).toBeInstanceOf(AuthError);
    expect((caught as AuthError).code).toBe("NotAuthorizedException");
  });
});
