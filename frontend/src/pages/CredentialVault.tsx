import React, { useState, useEffect, useRef, useCallback } from "react";

import {
  base64ToBuffer,
  decryptData,
  encryptData,
  createHMAC,
} from "../utils/cryptoUtils";
import { getEncryptionSalt } from "../services/dashServices";
import { deriveKey } from "../utils/deriveKey";
import {
  addEntry,
  deleteEntry,
  getEncryptedVault,
  updateEntry,
} from "../services/vaultservices";

const CredentialVault: React.FC = () => {
  const [masterPassword, setMasterPassword] = useState("");
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [credentials, setCredentials] = useState<any[]>([]);
  const [editingEntry, setEditingEntry] = useState<any | null>(null);
  const [error, setError] = useState("");

  const [isUnlocking, setIsUnlocking] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const [showAddForm, setShowAddForm] = useState<boolean>(false);
  const [newEntry, setNewEntry] = useState({
    website: "",
    username: "",
    password: "",
    notes: "",
  });

  const [aesKey, setAesKey] = useState<CryptoKey | null>(null);

  const AUTO_LOCK_TIME = 1 * 60 * 1000;
  const timeoutRef = useRef<number | undefined>(undefined);

  const lockVault = useCallback(() => {
    setVaultUnlocked(false);
    setAesKey(null);
    setCredentials([]);
    setEditingEntry(null);
    setShowAddForm(false);
    setMasterPassword("");
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = undefined;
    }
  }, []);

  const resetAutoLockTimer = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      lockVault();
      console.log("Vault auto-locked due to inactivity.");
    }, AUTO_LOCK_TIME);
  }, [lockVault]);

  useEffect(() => {
    if (!vaultUnlocked) return;

    const handleActivity = () => resetAutoLockTimer();

    window.addEventListener("mousemove", handleActivity);
    window.addEventListener("keydown", handleActivity);

    // Start the timer on vault unlock
    resetAutoLockTimer();

    return () => {
      window.removeEventListener("mousemove", handleActivity);
      window.removeEventListener("keydown", handleActivity);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [vaultUnlocked, resetAutoLockTimer]);

  const handleUnlock = async () => {
    setError("");
    setIsUnlocking(true);

    try {
      const response = await getEncryptionSalt();
      const { encryptionSalt, keyDerivationMethod, verification } = response;

      if (!encryptionSalt || !keyDerivationMethod || !verification) {
        throw new Error("Missing required encryption data from server.");
      }

      const { aesKey, hmacKey } = await deriveKey(
        masterPassword,
        base64ToBuffer(encryptionSalt),
        keyDerivationMethod
      );

      const hmacToVerify = await createHMAC(hmacKey, verification.secret);

      if (hmacToVerify !== verification.hmac) {
        throw new Error("Master password verification failed.");
      }

      const encrypted = await getEncryptedVault();

      const decrypted = await Promise.all(
        encrypted.data.map(async (entry: any) => {
          const decryptedWebsite = await decryptData(
            entry.website.cipherText,
            entry.website.iv,
            aesKey
          );
          const decryptedUsername = await decryptData(
            entry.username.cipherText,
            entry.username.iv,
            aesKey
          );
          const decryptedPassword = await decryptData(
            entry.password.cipherText,
            entry.password.iv,
            aesKey
          );
          const decryptedNotes = entry.notes
            ? await decryptData(entry.notes.cipherText, entry.notes.iv, aesKey)
            : "";

          return {
            ...entry,
            decryptedWebsite,
            decryptedUsername,
            decryptedPassword,
            decryptedNotes,
          };
        })
      );

      setAesKey(aesKey);
      setCredentials(decrypted);
      setVaultUnlocked(true);
    } catch (error) {
      console.error(error);
      setError("Incorrect master password or decryption failed.");
    } finally {
      setIsUnlocking(false);
    }
  };

  const handleAddEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aesKey) return;

    setIsAdding(true);
    setError("");

    try {
      const website = await encryptData(newEntry.website, aesKey);
      const username = await encryptData(newEntry.username, aesKey);
      const password = await encryptData(newEntry.password, aesKey);
      const notes = newEntry.notes
        ? await encryptData(newEntry.notes, aesKey)
        : null;

      await addEntry({
        website,
        username,
        password,
        notes,
      });

      setShowAddForm(false);
      setNewEntry({ website: "", username: "", password: "", notes: "" });
      handleUnlock(); // refresh entries
    } catch (err) {
      console.error("Add entry failed", err);
      setError("Failed to add entry.");
    } finally {
      setIsAdding(false);
    }
  };

  const handleEdit = (entry: any) => {
    setEditingEntry(entry);
  };

  const handleDelete = async (entryId: string) => {
    if (!window.confirm("Are you sure you want to delete this entry?")) return;

    try {
      await deleteEntry(entryId);
      handleUnlock(); // refresh vault
    } catch (err) {
      console.error("Delete failed", err);
      setError("Failed to delete entry.");
    }
  };

  if (!vaultUnlocked) {
    return (
      <div className="max-w-md mx-auto mt-10">
        <h2 className="text-xl font-bold mb-4">Enter Master Password</h2>
        <input
          autoComplete="off"
          name="master-password"
          type="password"
          value={masterPassword}
          onChange={(e) => setMasterPassword(e.target.value)}
          className="w-full border p-2 rounded mb-2"
        />
        <button
          onClick={handleUnlock}
          className="w-full bg-sky-700 text-white p-2 rounded hover:bg-sky-800"
          disabled={isUnlocking}
        >
          {isUnlocking ? "Unlocking..." : "Unlock Vault"}
        </button>
        {error && <p className="text-red-600 mt-3">{error}</p>}
      </div>
    );
  }

  return (
    <div className="max-w-full mx-auto mt-10 relative p-4">
      {isUnlocking && (
        <div className="absolute inset-0 bg-white/80 z-50 flex items-center justify-center">
          <div className="animate-spin h-10 w-10 border-4 border-sky-700 border-t-transparent rounded-full" />
        </div>
      )}
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold text-sky-800">Your Credentials</h2>
        <button
          onClick={() => setShowAddForm(true)}
          className="bg-sky-700 text-white px-4 py-2 rounded hover:bg-sky-800"
        >
          + Add Entry
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full table-auto border-collapse bg-white shadow rounded-md overflow-x-auto">
          <thead>
            <tr className="bg-sky-100 text-sky-800 font-semibold">
              <th className="px-4 py-2 border w-1/6">Website</th>
              <th className="px-4 py-2 border w-1/6">Username</th>
              <th className="px-4 py-2 border w-1/6">Password</th>
              <th className="px-4 py-2 border w-1/6">Notes</th>
              <th className="px-4 py-2 border w-1/6">Actions</th>
            </tr>
          </thead>
          <tbody>
            {credentials.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center py-6 text-gray-600">
                  No entries found.
                </td>
              </tr>
            ) : (
              credentials.map((cred, idx) => (
                <tr key={idx} className="hover:bg-gray-50">
                  <td className="border px-4 py-2">{cred.decryptedWebsite}</td>
                  <td className="border px-4 py-2">{cred.decryptedUsername}</td>
                  <td className="border px-4 py-2">{cred.decryptedPassword}</td>
                  <td className="border px-4 py-2">{cred.decryptedNotes}</td>
                  <td className="border px-4 py-2 text-center">
                    <button
                      onClick={() => handleEdit(cred)}
                      className="text-blue-600 hover:underline mr-3"
                    >
                      ✏️ Edit
                    </button>
                    <button
                      onClick={() => handleDelete(cred._id)}
                      className="text-red-600 hover:underline"
                    >
                      🗑 Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showAddForm && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md relative">
            {isAdding && (
              <div className="absolute inset-0 bg-white/80 flex justify-center items-center rounded-xl">
                <div className="animate-spin h-8 w-8 border-4 border-sky-700 border-t-transparent rounded-full" />
              </div>
            )}
            <h3 className="text-xl font-bold mb-4 text-sky-700">
              Add New Entry
            </h3>
            <form className="space-y-4" onSubmit={handleAddEntry}>
              <input
                type="text"
                placeholder="Website"
                value={newEntry.website}
                onChange={(e) =>
                  setNewEntry({ ...newEntry, website: e.target.value })
                }
                required
                className="w-full border p-2 rounded"
              />
              <input
                type="text"
                placeholder="Username"
                value={newEntry.username}
                onChange={(e) =>
                  setNewEntry({ ...newEntry, username: e.target.value })
                }
                required
                className="w-full border p-2 rounded"
              />
              <input
                type="text"
                placeholder="Password"
                value={newEntry.password}
                onChange={(e) =>
                  setNewEntry({ ...newEntry, password: e.target.value })
                }
                required
                className="w-full border p-2 rounded"
              />
              <textarea
                placeholder="Notes (optional)"
                value={newEntry.notes}
                onChange={(e) =>
                  setNewEntry({ ...newEntry, notes: e.target.value })
                }
                className="w-full border p-2 rounded"
              />
              <div className="flex justify-between items-center mt-4">
                <button
                  type="submit"
                  className="bg-sky-700 text-white px-4 py-2 rounded hover:bg-sky-800 disabled:opacity-50"
                  disabled={isAdding}
                >
                  {isAdding ? "Saving..." : "Save Entry"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="text-red-600 hover:underline"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {editingEntry && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md relative">
            {isUpdating && (
              <div className="absolute inset-0 bg-white/80 flex justify-center items-center rounded-xl">
                <div className="animate-spin h-8 w-8 border-4 border-sky-700 border-t-transparent rounded-full" />
              </div>
            )}
            <h3 className="text-xl font-bold mb-4 text-sky-700">Edit Entry</h3>
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!aesKey) return;

                setIsUpdating(true);
                setError("");

                try {
                  const website = await encryptData(
                    editingEntry.decryptedWebsite,
                    aesKey
                  );
                  const username = await encryptData(
                    editingEntry.decryptedUsername,
                    aesKey
                  );
                  const password = await encryptData(
                    editingEntry.decryptedPassword,
                    aesKey
                  );
                  const notes = editingEntry.decryptedNotes
                    ? await encryptData(editingEntry.decryptedNotes, aesKey)
                    : null;

                  await updateEntry(editingEntry._id, {
                    website,
                    username,
                    password,
                    notes,
                  });

                  setEditingEntry(null);
                  handleUnlock(); // refresh vault
                } catch (err) {
                  console.error("Edit failed", err);
                  setError("Failed to update entry.");
                } finally {
                  setIsUpdating(false);
                }
              }}
            >
              <input
                type="text"
                value={editingEntry.decryptedWebsite}
                onChange={(e) =>
                  setEditingEntry({
                    ...editingEntry,
                    decryptedWebsite: e.target.value,
                  })
                }
                className="w-full border p-2 rounded"
              />
              <input
                type="text"
                value={editingEntry.decryptedUsername}
                onChange={(e) =>
                  setEditingEntry({
                    ...editingEntry,
                    decryptedUsername: e.target.value,
                  })
                }
                className="w-full border p-2 rounded"
              />
              <input
                type="text"
                value={editingEntry.decryptedPassword}
                onChange={(e) =>
                  setEditingEntry({
                    ...editingEntry,
                    decryptedPassword: e.target.value,
                  })
                }
                className="w-full border p-2 rounded"
              />
              <textarea
                value={editingEntry.decryptedNotes}
                onChange={(e) =>
                  setEditingEntry({
                    ...editingEntry,
                    decryptedNotes: e.target.value,
                  })
                }
                className="w-full border p-2 rounded"
              />
              <div className="flex justify-between items-center mt-4">
                <button
                  type="submit"
                  className="bg-sky-700 text-white px-4 py-2 rounded hover:bg-sky-800 disabled:opacity-50"
                  disabled={isUpdating}
                >
                  {isUpdating ? "Saving..." : "Save Changes"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingEntry(null)}
                  className="text-red-600 hover:underline"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default CredentialVault;
