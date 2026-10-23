import {
  Suspense,
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { Outlet } from "react-router-dom";

import { Dialog } from "../../components/ui/Dialog";
import { StatusLine } from "../../components/ui/StatusLine";
import { useModalFlow } from "../../routes/modal-flow";

/** Where a detail names itself, for the dialog's title. */
const DetailTitle = createContext<Dispatch<SetStateAction<string>> | null>(
  null,
);

/**
 * The one modal surface every detail of a flow is shown in (`FRONTEND-014`): a
 * thread, a game, a player. The layout route over the overlay routes
 * (`routes/routes.tsx`), so it stays mounted while the details switch inside
 * it through its `<Outlet />`, and the `<dialog>` is the same element from the
 * flow's first detail to its last: exactly one is ever open, never one stacked
 * on another.
 *
 * **The flow's ways out are read here, once** (`useModalFlow`): Back steps to
 * the previous detail, Close and Escape leave the whole flow, and because the
 * `Dialog` is mounted only once per flow, the focus it gives back on the way
 * out is to what opened the flow's first detail.
 *
 * **Each detail names itself** with `useDetailTitle`, which becomes the
 * dialog's heading and accessible name: "Thread", "Game", "Player". It is set
 * in a layout effect, before the first paint and before the dialog is shown.
 *
 * Lives beside the thread because the thread is the modal's own detail (it
 * has no page); a game and a player are pages shown here as well, which their
 * features do not need to know.
 */
export function DetailModal() {
  const { back, close } = useModalFlow();
  const [title, setTitle] = useState("");

  return (
    <Dialog open onClose={close} onBack={back} title={title}>
      <DetailTitle.Provider value={setTitle}>
        {/*
         * A lazy detail (a game, a player: FRONTEND-015) is waited for in
         * here, so the dialog itself stays the same open element meanwhile.
         */}
        <Suspense fallback={<StatusLine>Loading…</StatusLine>}>
          <Outlet />
        </Suspense>
      </DetailTitle.Provider>
    </Dialog>
  );
}

/** Names the detail being shown: the dialog's title while it is. */
export function useDetailTitle(title: string): void {
  const setTitle = useContext(DetailTitle);
  useLayoutEffect(() => {
    setTitle?.(title);
  }, [setTitle, title]);
}
