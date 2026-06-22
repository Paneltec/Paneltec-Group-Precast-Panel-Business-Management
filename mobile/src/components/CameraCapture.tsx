import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, Platform, Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Colors } from '../lib/colors';

let CameraViewComponent: any = null;
let useCameraPermissionsHook: any = null;
try {
  const cam = require('expo-camera');
  CameraViewComponent = cam.CameraView;
  useCameraPermissionsHook = cam.useCameraPermissions;
} catch {}

export type CaptureResult = {
  uri: string;
  lat?: number;
  lng?: number;
  takenAt: string;
};

type Props = {
  visible: boolean;
  onCapture: (result: CaptureResult) => void;
  onClose: () => void;
};

export default function CameraCapture({ visible, onCapture, onClose }: Props) {
  // On web or if expo-camera unavailable, use ImagePicker fallback
  if (Platform.OS === 'web' || !CameraViewComponent) {
    return <FallbackCapture visible={visible} onCapture={onCapture} onClose={onClose} />;
  }
  return <NativeCamera visible={visible} onCapture={onCapture} onClose={onClose} />;
}

/* ---- Native camera viewfinder ---- */
function NativeCamera({ visible, onCapture, onClose }: Props) {
  const [permission, requestPermission] = useCameraPermissionsHook?.() ?? [null, async () => {}];
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [capturing, setCapturing] = useState(false);
  const cameraRef = useRef<any>(null);

  useEffect(() => {
    if (visible && permission && !permission.granted) {
      requestPermission();
    }
  }, [visible, permission]);

  // If permission denied and can't ask again, fall back
  if (permission && !permission.granted && !permission.canAskAgain) {
    return <FallbackCapture visible={visible} onCapture={onCapture} onClose={onClose} />;
  }

  const capture = async () => {
    if (capturing || !cameraRef.current) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      if (!photo?.uri) { setCapturing(false); return; }
      const coords = await getGps();
      onCapture({
        uri: photo.uri,
        lat: coords?.latitude,
        lng: coords?.longitude,
        takenAt: new Date().toISOString(),
      });
    } catch (e: any) {
      Alert.alert('Capture failed', e.message);
    }
    setCapturing(false);
  };

  return (
    <Modal visible={visible} animationType="slide" testID="camera-viewfinder-modal">
      <View style={styles.container}>
        {permission?.granted && CameraViewComponent ? (
          <CameraViewComponent
            ref={cameraRef}
            style={styles.camera}
            facing={facing}
          />
        ) : (
          <View style={[styles.camera, styles.permissionWait]}>
            <ActivityIndicator color="#FFF" />
            <Text style={styles.permText}>Requesting camera access...</Text>
          </View>
        )}

        {/* Top bar */}
        <View style={styles.topBar}>
          <TouchableOpacity testID="camera-cancel-btn" style={styles.topBtn} onPress={onClose}>
            <Ionicons name="close" size={28} color="#FFF" />
          </TouchableOpacity>
          <TouchableOpacity
            testID="camera-flip-btn"
            style={styles.topBtn}
            onPress={() => setFacing(f => f === 'back' ? 'front' : 'back')}
          >
            <Ionicons name="camera-reverse" size={28} color="#FFF" />
          </TouchableOpacity>
        </View>

        {/* Bottom bar — capture button */}
        <View style={styles.bottomBar}>
          <View style={styles.gpsIndicator}>
            <Ionicons name="location" size={14} color={Colors.safetyYellow} />
            <Text style={styles.gpsText}>GPS auto-tagged</Text>
          </View>
          <TouchableOpacity
            testID="camera-shutter-btn"
            style={styles.shutterBtn}
            onPress={capture}
            disabled={capturing}
          >
            {capturing ? (
              <ActivityIndicator color={Colors.charcoal} />
            ) : (
              <View style={styles.shutterInner} />
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

/* ---- Fallback: ImagePicker + GPS ---- */
function FallbackCapture({ visible, onCapture, onClose }: Props) {
  useEffect(() => {
    if (!visible) return;
    (async () => {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Camera access denied', 'Enable camera in device settings to capture photos.');
        onClose();
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });
      if (result.canceled) { onClose(); return; }
      const coords = await getGps();
      onCapture({
        uri: result.assets[0].uri,
        lat: coords?.latitude,
        lng: coords?.longitude,
        takenAt: new Date().toISOString(),
      });
    })();
  }, [visible]);

  return null; // ImagePicker opens as a system dialog
}

/* ---- GPS helper ---- */
async function getGps(): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    return { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  permissionWait: { justifyContent: 'center', alignItems: 'center', gap: 12 },
  permText: { color: '#FFF', fontSize: 14 },
  topBar: {
    position: 'absolute', top: 50, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  topBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },
  bottomBar: {
    position: 'absolute', bottom: 40, left: 0, right: 0,
    alignItems: 'center', gap: 12,
  },
  gpsIndicator: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 16,
  },
  gpsText: { color: Colors.safetyYellow, fontSize: 11, fontWeight: '700' },
  shutterBtn: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center',
    borderWidth: 4, borderColor: 'rgba(255,255,255,0.5)',
  },
  shutterInner: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#FFF',
  },
});
