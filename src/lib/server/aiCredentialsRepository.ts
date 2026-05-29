import admin from "firebase-admin";
import { getDefaultAISettings } from "../ai/providerRegistry";

export interface AISecretData {
  provider: string;
  apiKey: string;
  keyMasked: string;
  baseUrl?: string;
  model?: string;
  createdAt?: any;
  updatedAt?: any;
}

/**
 * Recovers safe server-side AI Secret config for a user, or null if unconfigured
 */
export async function getAISecret(uid: string): Promise<AISecretData | null> {
  try {
    const docRef = admin.firestore().collection("users").doc(uid).collection("secrets").doc("ai");
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return null;
    }
    return docSnap.data() as AISecretData;
  } catch (err: any) {
    console.error(`[aiCredentialsRepository.getAISecret Error for ${uid}]:`, err.message);
    throw new Error("FIRESTORE_UNAVAILABLE");
  }
}

/**
 * Saves or merges user server-side AI Secret keys
 */
export async function saveAISecret(
  uid: string,
  data: Partial<AISecretData>
): Promise<AISecretData> {
  try {
    const docRef = admin.firestore().collection("users").doc(uid).collection("secrets").doc("ai");
    const docSnap = await docRef.get();
    const savedData = docSnap.exists ? docSnap.data() : null;

    const dataToSave = {
      ...data,
      createdAt: savedData ? (savedData.createdAt || admin.firestore.FieldValue.serverTimestamp()) : admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await docRef.set(dataToSave, { merge: true });
    return dataToSave as AISecretData;
  } catch (err: any) {
    console.error(`[aiCredentialsRepository.saveAISecret Error for ${uid}]:`, err.message);
    throw new Error("FIRESTORE_UNAVAILABLE");
  }
}

/**
 * Cleanly deletes AI secrets and switches AI options off
 */
export async function deleteAISecret(uid: string): Promise<void> {
  try {
    const secretsRef = admin.firestore().collection("users").doc(uid).collection("secrets").doc("ai");
    await secretsRef.delete();

    const settingsRef = admin.firestore().collection("users").doc(uid).collection("settings").doc("ai");
    const settingsDoc = await settingsRef.get();
    
    let currentSettings = getDefaultAISettings();
    if (settingsDoc.exists) {
      currentSettings = { ...currentSettings, ...settingsDoc.data() };
    }

    const updatedSettings = {
      ...currentSettings,
      aiEnabled: false,
      aiUseForOCR: false,
      aiUseForCategoryFallback: false,
      aiUseForInsights: false,
      aiUseForReports: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await settingsRef.set(updatedSettings, { merge: true });
  } catch (err: any) {
    console.error(`[aiCredentialsRepository.deleteAISecret Error for ${uid}]:`, err.message);
    throw new Error("FIRESTORE_UNAVAILABLE");
  }
}

/**
 * Recovers AI integration permission flags and configurations
 */
export async function getAISettings(uid: string): Promise<any> {
  try {
    const settingsDoc = await admin.firestore().collection("users").doc(uid).collection("settings").doc("ai").get();
    if (!settingsDoc.exists) {
      return getDefaultAISettings();
    }
    const data = settingsDoc.data() || {};
    const defaults = getDefaultAISettings();
    return {
      aiEnabled: data.aiEnabled ?? defaults.aiEnabled,
      provider: data.provider ?? defaults.provider,
      model: data.model ?? defaults.model,
      baseUrl: data.baseUrl ?? defaults.baseUrl,
      aiUseForOCR: data.aiUseForOCR ?? defaults.aiUseForOCR,
      aiUseForCategoryFallback: data.aiUseForCategoryFallback ?? defaults.aiUseForCategoryFallback,
      aiUseForInsights: data.aiUseForInsights ?? defaults.aiUseForInsights,
      aiUseForReports: data.aiUseForReports ?? defaults.aiUseForReports,
      aiAlwaysAskBeforeSending: data.aiAlwaysAskBeforeSending ?? defaults.aiAlwaysAskBeforeSending
    };
  } catch (err: any) {
    console.error(`[aiCredentialsRepository.getAISettings Error for ${uid}]:`, err.message);
    throw new Error("FIRESTORE_UNAVAILABLE");
  }
}

/**
 * Saves configuration setting preferences
 */
export async function saveAISettings(uid: string, settingsToSave: any): Promise<any> {
  try {
    const settingsRef = admin.firestore().collection("users").doc(uid).collection("settings").doc("ai");
    await settingsRef.set({
      ...settingsToSave,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return settingsToSave;
  } catch (err: any) {
    console.error(`[aiCredentialsRepository.saveAISettings Error for ${uid}]:`, err.message);
    throw new Error("FIRESTORE_UNAVAILABLE");
  }
}
