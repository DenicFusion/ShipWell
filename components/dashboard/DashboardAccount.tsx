import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { updateProfile, type User } from "firebase/auth";
import toast from "react-hot-toast";
import { useShipWell } from "@/components/providers/ShipWellProvider";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { updateUserAccountProfile } from "@/lib/firestore-shipments";
import {
  firestoreTimeToMs,
  formatTimeAgo,
  getInitials,
  type NotificationPrefs,
  type UserProfile,
} from "@/types/tracking";

export function DashboardAccount({
  user,
  profile,
}: {
  user: User;
  profile: UserProfile | null;
}) {
  const { refreshProfile, signOutUser } = useShipWell();
  const navigate = useNavigate();

  const initialName =
    profile?.name ||
    user.displayName ||
    user.email?.split("@")[0] ||
    "ShipWell Customer";
  const initialPhone = profile?.phone || "";
  const initialPrefs: NotificationPrefs = {
    onway: profile?.prefs?.onway !== false,
    scan: profile?.prefs?.scan !== false,
    action: profile?.prefs?.action !== false,
  };

  const [draftName, setDraftName] = useState<string | null>(null);
  const [draftPhone, setDraftPhone] = useState<string | null>(null);
  const [draftPrefs, setDraftPrefs] = useState<NotificationPrefs | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const name = draftName ?? initialName;
  const phone = draftPhone ?? initialPhone;
  const prefs = draftPrefs ?? initialPrefs;

  const joinedMs = profile?.createdAt
    ? firestoreTimeToMs(profile.createdAt)
    : user.metadata?.creationTime
      ? Date.parse(user.metadata.creationTime)
      : 0;
  const joinedLabel = joinedMs ? `joined ${formatTimeAgo(joinedMs)}` : "member";

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!name.trim()) {
      setError("Please enter your name");
      return;
    }
    setSaving(true);
    try {
      await updateUserAccountProfile({
        uid: user.uid,
        name: name.trim(),
        phone: phone.trim(),
      });
      await updateProfile(user, { displayName: name.trim() }).catch(() => null);
      await refreshProfile();
      setDraftName(null);
      setDraftPhone(null);
      toast.success("Profile saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save profile.");
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePref = async (
    key: keyof NotificationPrefs,
    nextVal: boolean
  ) => {
    const prevPrefs = prefs;
    const nextPrefs = { ...prefs, [key]: nextVal };
    setDraftPrefs(nextPrefs);
    try {
      await updateUserAccountProfile({
        uid: user.uid,
        prefs: nextPrefs,
      });
      await refreshProfile();
      setDraftPrefs(null);
      toast.success("Preference saved");
    } catch {
      setDraftPrefs(prevPrefs);
      toast.error("Could not update preference");
    }
  };

  const handleSignOut = async () => {
    await signOutUser();
    navigate("/");
  };

  return (
    <div className="dx-acc">
      <div className="dx-card">
        <div className="dx-prof">
          <div className="dx-av">{getInitials(name)}</div>
          <div>
            <b>{name}</b>
            <small>
              {user.email} · {joinedLabel}
            </small>
          </div>
        </div>

        <form className="dx-cb" onSubmit={handleSaveProfile} noValidate>
          <div className="fw">
            <label className="lbl" htmlFor="dxName">
              Full name
            </label>
            <input
              className="field"
              id="dxName"
              name="name"
              value={name}
              onChange={(e) => setDraftName(e.target.value)}
              autoComplete="name"
            />
          </div>
          <div className="fw">
            <label className="lbl" htmlFor="dxPhone">
              Phone
            </label>
            <input
              className="field"
              id="dxPhone"
              name="phone"
              value={phone}
              onChange={(e) => setDraftPhone(e.target.value)}
              autoComplete="tel"
              placeholder="+234 ..."
            />
          </div>
          <div className="fw">
            <label className="lbl" htmlFor="dxEmail">
              Email
            </label>
            <input
              className="field"
              id="dxEmail"
              value={user.email || ""}
              disabled
            />
          </div>
          {error && <div className="au-err mb-3">{error}</div>}
          <button
            type="submit"
            disabled={saving}
            className="sw-btn sw-btn-em"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </form>
      </div>

      <div className="dx-col">
        <div className="dx-card">
          <div className="dx-ch">
            <h3>Appearance</h3>
          </div>
          <div className="dx-cb">
            <p
              style={{
                fontSize: 13,
                color: "var(--muted)",
                marginBottom: 12,
                lineHeight: 1.55,
              }}
            >
              Choose System to match your device theme automatically, or pick
              Dark or Light across all your devices.
            </p>
            <ThemeSwitch />
          </div>
        </div>

        <div className="dx-card">
          <div className="dx-ch">
            <h3>Email notifications</h3>
          </div>
          <div className="dx-cb">
            <label className="dx-sw">
              <div>
                <b>A parcel is on its way to me</b>
                <small>When someone ships to your email</small>
              </div>
              <input
                type="checkbox"
                checked={prefs.onway}
                onChange={(e) => handleTogglePref("onway", e.target.checked)}
              />
            </label>

            <label className="dx-sw">
              <div>
                <b>Tracking updates</b>
                <small>Every new checkpoint and delay</small>
              </div>
              <input
                type="checkbox"
                checked={prefs.scan}
                onChange={(e) => handleTogglePref("scan", e.target.checked)}
              />
            </label>

            <label className="dx-sw">
              <div>
                <b>Action required</b>
                <small>Duty, ID, address or delivery slot</small>
              </div>
              <input
                type="checkbox"
                checked={prefs.action}
                onChange={(e) => handleTogglePref("action", e.target.checked)}
              />
            </label>
          </div>
        </div>

        <div className="dx-card">
          <div
            className="dx-cb"
            style={{ display: "flex", gap: 10, flexWrap: "wrap" }}
          >
            <Link className="sw-btn sw-btn-ghost" to="/">
              Back to website
            </Link>
            <button
              type="button"
              className="sw-btn sw-btn-ghost"
              onClick={handleSignOut}
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
