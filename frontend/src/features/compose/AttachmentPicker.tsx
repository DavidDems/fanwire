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

/**
 * The summaries of the links attached in one compose context (a mediator and
 * a pre-filled address): a new context starts with none.
 */
interface Summaries {
  mediator: ComposeMediator;
  key: string;
  byLink: ReadonlyMap<string, string>;
}

const NO_SUMMARIES: ReadonlyMap<string, string> = new Map();

/** Summaries survive picker unmounts and mediator Undo. */
export function useAttachments(
  mediator: ComposeMediator,
  prefill: AddressLink | null,
) {
  const draft = useSyncExternalStore(mediator.subscribe, mediator.getDraft);
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
  const key =
    prefill === null ? "" : `${dataLinkKey(prefill.link)}|${prefill.gameId}`;
  const [summaries, setSummaries] = useState<Summaries>(() => ({
    mediator,
    key,
    byLink: NO_SUMMARIES,
  }));
  // Summaries kept for another context are not this one's.
  const byLink =
    summaries.mediator === mediator && summaries.key === key
      ? summaries.byLink
      : NO_SUMMARIES;
  // The pre-filled link's summary is the check's answer, while it is this
  // context's link.
  const prefillSummary =
    prefill !== null && check.data?.ok === true
      ? { link: dataLinkKey(prefill.link), text: check.data.summary }
      : null;
  function summaryOf(link: DataLink): string | undefined {
    const at = dataLinkKey(link);
    return (
      byLink.get(at) ??
      (prefillSummary?.link === at ? prefillSummary.text : undefined)
    );
  }

  // The context the pre-filled link was last attached in: once per context.
  const prefillApplied = useRef<{
    mediator: ComposeMediator;
    key: string;
  } | null>(null);
  useEffect(() => {
    // Once per mount: StrictMode re-runs the effect, and a second send would
    // put a second snapshot on the undo history.
    if (prefill === null || check.data?.ok !== true) return;
    const applied = prefillApplied.current;
    if (applied?.mediator === mediator && applied.key === key) return;
    prefillApplied.current = { mediator, key };
    mediator.send("attachment", { kind: "link-attached", link: prefill.link });
  }, [prefill, check.data, mediator, key]);

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
              {summaryOf(draft.dataLink) ?? describeBareLink(draft.dataLink)}
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
      setSummaries((previous) => ({
        mediator,
        key,
        byLink: new Map(
          previous.mediator === mediator && previous.key === key
            ? previous.byLink
            : NO_SUMMARIES,
        ).set(dataLinkKey(link), summary),
      }));
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
