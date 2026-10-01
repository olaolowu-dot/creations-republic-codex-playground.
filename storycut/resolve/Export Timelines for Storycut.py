#!/usr/bin/env python3
"""
Export every timeline in the current DaVinci Resolve project as FCPXML for Storycut.

Install (copy this file into Resolve's Utility scripts folder, then restart Resolve):
  macOS:   ~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility/
  Windows: %APPDATA%\\Blackmagic Design\\DaVinci Resolve\\Support\\Fusion\\Scripts\\Utility\\
  Linux:   ~/.local/share/DaVinciResolve/Fusion/Scripts/Utility/

Run: open a project, then Workspace > Scripts > Export Timelines for Storycut.
Files are written to ~/Desktop/Storycut/<project name>/<timeline name>.fcpxml.
Repeat in each project, then add all the files in Storycut's "Resolve → Script" tab.
"""
import os
import re


def get_resolve():
    # Resolve injects `resolve` (or `app`) when the script runs from its Scripts menu.
    g = globals()
    if g.get("resolve"):
        return g["resolve"]
    if g.get("app"):
        return g["app"].GetResolve()
    import DaVinciResolveScript as dvr  # external scripting (Resolve Studio)
    return dvr.scriptapp("Resolve")


def safe(name):
    return re.sub(r'[\\/:*?"<>|]+', "_", name).strip() or "untitled"


def main():
    resolve = get_resolve()
    if resolve is None:
        print("Storycut: could not connect to DaVinci Resolve.")
        return
    project = resolve.GetProjectManager().GetCurrentProject()
    if project is None:
        print("Storycut: open a project first.")
        return

    # Newest FCPXML version this Resolve build knows about.
    export_type = None
    for attr in ("EXPORT_FCPXML_1_10", "EXPORT_FCPXML_1_9", "EXPORT_FCPXML_1_8"):
        export_type = getattr(resolve, attr, None)
        if export_type is not None:
            ext = ".fcpxml"
            break
    if export_type is None:
        export_type, ext = resolve.EXPORT_FCP_7_XML, ".xml"

    out_dir = os.path.join(os.path.expanduser("~"), "Desktop", "Storycut", safe(project.GetName()))
    os.makedirs(out_dir, exist_ok=True)

    count = project.GetTimelineCount()
    written = 0
    for i in range(1, count + 1):
        timeline = project.GetTimelineByIndex(i)
        path = os.path.join(out_dir, safe(timeline.GetName()) + ext)
        if timeline.Export(path, export_type, resolve.EXPORT_NONE):
            written += 1
            print("Storycut: wrote " + path)
        else:
            print("Storycut: FAILED to export " + timeline.GetName())

    print("Storycut: exported %d of %d timelines to %s" % (written, count, out_dir))


main()
