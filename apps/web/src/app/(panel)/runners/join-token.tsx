"use client";

import { useState, useTransition } from "react";
import { createJoinTokenAction } from "../../actions";

export function JoinToken() {
  const [token, setToken] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="stack" style={{ marginTop: 12 }}>
      <div>
        <button
          className="primary"
          type="button"
          disabled={pending}
          onClick={() => start(async () => setToken(await createJoinTokenAction()))}
        >
          {pending ? "Creating…" : "Create join token"}
        </button>
      </div>
      {token ? (
        <>
          <code className="token">{token}</code>
          <span className="faint small">Valid for 7 days. Personal runners are owned by you.</span>
        </>
      ) : null}
    </div>
  );
}
