"use client";

import * as React from "react";
import { Check, Download, MonitorDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, Pill } from "../ui";
import { useToast } from "../toast";
import { DESKTOP_DOWNLOAD_URL } from "@/lib/constant";
import { useInstallPrompt, useIsElectron } from "@/lib/install-prompt";

const PERKS = [
  "Floats above Zoom, Meet and Teams",
  "Hidden from screen sharing",
  "Global shortcuts while you're in the call",
];

/** "Get the desktop app" — installer download and/or browser install. Hidden
 *  inside the desktop app itself. */
export function DesktopAppCard({ className }: { className?: string }) {
  const inElectron = useIsElectron();
  const { canInstall, installed, install } = useInstallPrompt();
  const toast = useToast();

  if (inElectron) return null;

  const onInstall = async () => {
    if (await install()) toast.success("Installed — open it from your desktop or Start menu.");
  };

  return (
    <Card
      className={className}
      title="Desktop app"
      description="Captures meeting audio straight from your computer — no screen-share prompt — and stays hidden from screen sharing."
      actions={installed ? <Pill tone="success" dot>Installed</Pill> : undefined}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        <ul className="grid flex-1 gap-2 sm:grid-cols-3">
          {PERKS.map((p) => (
            <li key={p} className="flex items-start gap-2 text-[13px] text-text-secondary">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-text" />
              {p}
            </li>
          ))}
        </ul>
        {(DESKTOP_DOWNLOAD_URL || canInstall) && (
          <div className="flex shrink-0 flex-wrap gap-2">
            {DESKTOP_DOWNLOAD_URL && (
              <Button asChild>
                <a href={DESKTOP_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">
                  <Download className="mr-1.5 h-3.5 w-3.5" /> Download for Windows / macOS
                </a>
              </Button>
            )}
            {canInstall && !DESKTOP_DOWNLOAD_URL && (
              <Button variant={DESKTOP_DOWNLOAD_URL ? "outline" : "default"} onClick={onInstall}>
                <MonitorDown className="mr-1.5 h-3.5 w-3.5" /> Install from browser
              </Button>
            )}
          </div>
        )}
      </div>
      {!DESKTOP_DOWNLOAD_URL && !canInstall && !installed && (
        <p className="mt-4 border-t border-border-subtle pt-3 text-xs leading-relaxed text-text-tertiary">
          In Chrome or Edge, use the install icon at the right of the address bar (or menu → Apps → Install) to add
          the assistant to your desktop. Ask support for the full desktop installer.
        </p>
      )}
    </Card>
  );
}
