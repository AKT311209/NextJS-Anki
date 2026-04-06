import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { AppRuntimeStatus } from "@/components/shared/AppRuntimeStatus";
import { markBackupCompleted } from "@/lib/offline/backup-reminder";

describe("Phase 8 app runtime status", () => {
    beforeEach(() => {
        localStorage.clear();
        setNavigatorOnline(true);
    });

    it("shows offline state when browser is offline", async () => {
        setNavigatorOnline(false);

        render(<AppRuntimeStatus />);

        expect(await screen.findByTestId("network-status-pill")).toHaveTextContent("Offline");
        expect(screen.getByText(/you can keep reviewing offline/i)).toBeInTheDocument();
    });

    it("shows backup reminder when no backup exists and can snooze it", async () => {
        const user = userEvent.setup();

        render(<AppRuntimeStatus />);

        expect(await screen.findByRole("link", { name: /backup now/i })).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /remind tomorrow/i }));

        expect(screen.queryByRole("link", { name: /backup now/i })).not.toBeInTheDocument();
        expect(screen.getByRole("link", { name: /^backup$/i })).toBeInTheDocument();
    });

    it("shows recent backup status without reminder", async () => {
        markBackupCompleted(Date.now());

        render(<AppRuntimeStatus />);

        expect(await screen.findByText(/backed up/i)).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: /backup now/i })).not.toBeInTheDocument();
        expect(screen.getByRole("link", { name: /^backup$/i })).toBeInTheDocument();
    });
});

function setNavigatorOnline(value: boolean): void {
    Object.defineProperty(window.navigator, "onLine", {
        configurable: true,
        get: () => value,
    });
}
