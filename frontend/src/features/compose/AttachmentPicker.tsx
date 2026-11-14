import { useQuery } from "@tanstack/react-query";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { ChartColumnIcon } from "../../components/ui/icons";
import { InlineAlert } from "../../components/ui/InlineAlert";
import { StatusLine } from "../../components/ui/StatusLine";
import { retryStyles } from "./retryStyles";
import type { ComposeMediator } from "./ComposeMediator";
import { checkAddressLink, describeBareLink } from "./attachmentReads";
import { dataLinkKey, type DataLink } from "./dataLink";
import styles from "./AttachmentPicker.module.css";

export interface AddressLink {
  link: DataLink;
  gameId: number | null;
}

/** Summaries survive picker unmounts and mediator Undo. */
export function useAttachments(
  mediator: ComposeMediator,
  prefill: AddressLink | null,
) {
  const draft = useSyncExternalStore(mediator.subscribe, mediator.getDraft);
  const summaries = useRef(new Map<string, string>());
  const check = useQuery({
    queryKey: [
      "compose",
      "address-link",
      prefill === null ? null : dataLinkKey(prefill.link),
      prefill?.gameId ?? null,
    ],
    queryFn: () => {
      if (prefill === null)
        throw new Error("The address check ran with no link.");
      return checkAddressLink(prefill.link, prefill.gameId);
    },
    enabled: prefill !== null,
    // A 404 is an answer, not a blip: say so at once rather than retrying it.
    retry: false,
    staleTime: Infinity,
  });
  const prefillApplied = useRef(false);
  const key =
    prefill === null ? "" : `${dataLinkKey(prefill.link)}|${prefill.gameId}`;
  const context = useRef({ mediator, key });
  if (context.current.mediator !== mediator || context.current.key !== key) {
    context.current = { mediator, key };
    prefillApplied.current = false;
    summaries.current.clear();
  }

  useEffect(() => {
    // Once per mount: StrictMode re-runs the effect, and a second send would
    // put a second snapshot on the undo history.
    if (prefill === null || prefillApplied.current) return;
    if (check.data?.ok !== true) return;
    prefillApplied.current = true;
    summaries.current.set(dataLinkKey(prefill.link), check.data.summary);
    mediator.send("attachment", { kind: "link-attached", link: prefill.link });
  }, [prefill, check.data, mediator]);

  let addressNote: ReactNode = null;
  if (prefill !== null && draft.dataLink === null) {
    if (check.isPending) {
      addressNote = <StatusLine>Loading the stats in this link…</StatusLine>;
    } else if (check.data?.ok === false) {
      addressNote = <StatusLine>{check.data.note}</StatusLine>;
    }
  }

  return {
    summary: (
      <>
        {addressNote}
        {draft.dataLink === null ? null : (
          <section className={styles.summary} aria-label="Attached stats">
            <p className={styles.summaryText}>
              {summaries.current.get(dataLinkKey(draft.dataLink)) ??
                describeBareLink(draft.dataLink)}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                mediator.send("attachment", { kind: "link-removed" })
              }
            >
              Remove attached stats
            </Button>
          </section>
        )}
      </>
    ),
    attach: (link: DataLink, summary: string) => {
      summaries.current.set(dataLinkKey(link), summary);
      mediator.send("attachment", { kind: "link-attached", link });
    },
  };
}

export function StatsToggle({
  id,
  onToggle,
}: {
  id: string;
  onToggle(): void;
}) {
  return (
    <Button
      id={id}
      type="button"
      variant="ghost"
      size="md"
      className={styles.toggle}
      aria-label="Attach stats"
      aria-haspopup="dialog"
      onClick={onToggle}
    >
      <ChartColumnIcon />
    </Button>
  );
}

type PickerModule = typeof import("./StatsPicker");
let rejected = false;
let loading: Promise<PickerModule> | null = null;
function loadPicker() {
  loading ??= (rejected ? retryStyles() : Promise.resolve())
    .then(() => import("./StatsPicker"))
    .catch((error: unknown) => {
      loading = null;
      rejected = true;
      throw error;
    });
  return loading;
}
/** Mounted outside the compose form; the Dialog owns dismissal and focus. */
export function PickerDialog({
  onClose,
  onAttach,
}: {
  onClose(): void;
  onAttach(link: DataLink, summary: string): void;
}) {
  const [module, setModule] = useState<PickerModule | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    void loadPicker().then(
      (value) => {
        if (current) setModule(value);
      },
      () => {
        if (current) setFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, [attempt]);
  const Loaded = module?.StatsPicker;
  return (
    <Dialog open title="Attach stats" onClose={onClose}>
      {Loaded ? (
        <Loaded
          onAttach={(link, summary) => {
            onAttach(link, summary);
            onClose();
          }}
          onClose={onClose}
        />
      ) : failed ? (
        <>
          <InlineAlert>
            We could not open this just now. Please try again.
          </InlineAlert>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => {
              setFailed(false);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
        </>
      ) : (
        <StatusLine>Loading…</StatusLine>
      )}
    </Dialog>
  );
}
