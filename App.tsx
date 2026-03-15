import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Vibration,
} from 'react-native';
import { launchCamera, launchImageLibrary, ImagePickerResponse } from 'react-native-image-picker';
import { db, storage } from './firebaseConfig';
import { collection, addDoc, getDocs, query, orderBy } from 'firebase/firestore';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';

// ================== Domain Models ==================

type ReportType = 'POTHOLE' | 'TRASH' | 'VANDALISM';

type SeverityLevel = 'LOW' | 'MEDIUM' | 'HIGH';

type ReportStatus = 'PENDING' | 'IN_PROGRESS' | 'RESOLVED';

interface User {
  id: string;
  name: string;
  icNumber: string;
  isVerified: boolean;
}

interface Location {
  latitude: number;
  longitude: number;
  address?: string;
}

interface Prediction {
  class: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RoboflowResponse {
  predictions: Prediction[];
  image: {
    width: number;
    height: number;
  };
  time: number;
}

interface ReportPayload {
  reporter: User;
  type: ReportType;
  photoUri: string;
  photoBase64?: string;
  location: Location;
  description: string;
  severity: SeverityLevel;
  createdAt: string;
}

interface SubmittedReport extends ReportPayload {
  id: string;
  status: ReportStatus;
}

// ================== Service Interfaces ==================
// (Dependency Inversion: UI depends on these abstractions, not concrete APIs)

interface AuthService {
  signUpAndVerify(payload: {
    name: string;
    icNumber: string;
    icFrontUri: string;
    icBackUri: string;
  }): Promise<User>;
}

interface LocationService {
  getCurrentLocation(): Promise<Location>;
}

interface AiModelService {
  inferSeverity(imageData: string, type: ReportType): Promise<{
    severity: SeverityLevel;
    confidence: number; // e.g. 0–1
  }>;
}

interface ReportService {
  submitReport(report: ReportPayload): Promise<void>;
}

// ================== Mock Implementations ==================
// Replace these with real Firebase / Roboflow / GPS logic later.

class MockAuthService implements AuthService {
  async signUpAndVerify({
    name,
    icNumber,
  }: {
    name: string;
    icNumber: string;
    icFrontUri: string;
    icBackUri: string;
  }): Promise<User> {
    // Simulate server verification
    await new Promise((r) => setTimeout(r, 800));
    return {
      id: 'user_001',
      name,
      icNumber,
      isVerified: true,
    };
  }
}

class MockLocationService implements LocationService {
  async getCurrentLocation(): Promise<Location> {
    // Replace with real GPS; this is a placeholder for demo.
    await new Promise((r) => setTimeout(r, 300));
    return {
      latitude: 3.139,
      longitude: 101.6869,
      address: 'Kuala Lumpur, Federal Territory of Kuala Lumpur, Malaysia',
    };
  }
}

class RoboflowAiModelService implements AiModelService {
  async inferSeverity(
    imageData: string,
    type: ReportType
  ): Promise<{ severity: SeverityLevel; confidence: number }> {
    // If we don't have image data, we cannot meaningfully call the model.
    if (!imageData) {
      return { severity: 'LOW', confidence: 0 };
    }

    try {
      const response = await fetch(
        'https://serverless.roboflow.com/vandalism-zfcdk/1?api_key=sIz4RIWe6eVwTp0EEC0i',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: imageData,
        }
      );

      if (!response.ok) {
        throw new Error(`Roboflow error: ${response.status}`);
      }

      const data: RoboflowResponse = await response.json();
      const predictions = data.predictions || [];

      if (predictions.length === 0) {
        return { severity: 'LOW', confidence: 0 };
      }

      const top = predictions.reduce((max, p) =>
        p.confidence > max.confidence ? p : max
      );
      const confidence = top.confidence;
      const severity: SeverityLevel =
        confidence > 0.85 ? 'HIGH' : confidence > 0.5 ? 'MEDIUM' : 'LOW';

      return { severity, confidence };
    } catch (error) {
      console.warn('Roboflow model error', error);
      // On hard failure, we have no confidence from the model;
      // treat as lowest severity.
      return { severity: 'LOW', confidence: 0 };
    }
  }
}

class FirebaseReportService implements ReportService {
  async submitReport(report: ReportPayload): Promise<void> {
    let photoUrl = report.photoUri;

    // Upload image to Firebase Storage if base64 data is available
    if (report.photoBase64) {
      try {
        const imageRef = ref(storage, `reports/${Date.now()}.jpg`);
        await uploadString(imageRef, report.photoBase64, 'base64');
        photoUrl = await getDownloadURL(imageRef);
      } catch (error) {
        console.warn('Image upload failed, using local URI', error);
      }
    }

    // Write report document to Firestore
    await addDoc(collection(db, 'reports'), {
      reporterName: report.reporter.name,
      reporterIc: report.reporter.icNumber,
      reporterId: report.reporter.id,
      type: report.type,
      photoUrl,
      latitude: report.location.latitude,
      longitude: report.location.longitude,
      address: report.location.address || '',
      description: report.description,
      severity: report.severity,
      status: 'PENDING',
      createdAt: report.createdAt,
    });
  }
}

// ================== Service Context (DI Container) ==================

interface ServiceContainer {
  authService: AuthService;
  locationService: LocationService;
  aiModelService: AiModelService;
  reportService: ReportService;
}

const ServiceContext = createContext<ServiceContainer | null>(null);

const useServices = (): ServiceContainer => {
  const ctx = useContext(ServiceContext);
  if (!ctx) {
    throw new Error('ServiceContext not provided');
  }
  return ctx;
};

// ================== Navigation State ==================

type Screen =
  | { name: 'SIGN_UP' }
  | { name: 'HOME' }
  | { name: 'REPORT_TYPE' }
  | { name: 'REPORT_CAPTURE'; type: ReportType }
  | { name: 'MY_REPORTS' };

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'SIGN_UP' });
  const [reports, setReports] = useState<SubmittedReport[]>([]);

  const services: ServiceContainer = {
    authService: new MockAuthService(),
    locationService: new MockLocationService(),
    aiModelService: new RoboflowAiModelService(),
    reportService: new FirebaseReportService(),
  };

  // Fetch existing reports from Firestore on mount
  const fetchReports = async () => {
    try {
      const q = query(collection(db, 'reports'), orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      const fetched: SubmittedReport[] = snapshot.docs.map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          reporter: {
            id: d.reporterId || '',
            name: d.reporterName || '',
            icNumber: d.reporterIc || '',
            isVerified: true,
          },
          type: d.type as ReportType,
          photoUri: d.photoUrl || '',
          location: {
            latitude: d.latitude || 0,
            longitude: d.longitude || 0,
            address: d.address || '',
          },
          description: d.description || '',
          severity: d.severity as SeverityLevel,
          createdAt: d.createdAt || '',
          status: (d.status || 'PENDING') as ReportStatus,
        };
      });
      setReports(fetched);
    } catch (error) {
      console.warn('Failed to fetch reports from Firestore', error);
    }
  };

  useEffect(() => {
    fetchReports();
  }, []);

  const handleSignedIn = (signedInUser: User) => {
    setUser(signedInUser);
    setScreen({ name: 'HOME' });
  };

  const handleReportSubmitted = (report: SubmittedReport) => {
    setReports((prev) => [report, ...prev]);
    setScreen({ name: 'MY_REPORTS' });
  };

  const currentTab: 'HOME' | 'REPORT' | 'MY_REPORTS' =
    screen.name === 'REPORT_TYPE' || screen.name === 'REPORT_CAPTURE'
      ? 'REPORT'
      : screen.name === 'MY_REPORTS'
        ? 'MY_REPORTS'
        : 'HOME';

  const renderScreen = () => {
    if (!user) {
      return <SignUpScreen onSignedIn={handleSignedIn} />;
    }

    switch (screen.name) {
      case 'HOME':
        return <HomeScreen onStartReport={() => setScreen({ name: 'REPORT_TYPE' })} user={user} />;
      case 'REPORT_TYPE':
        return (
          <ReportTypeScreen
            onSelectType={(type) => setScreen({ name: 'REPORT_CAPTURE', type })}
            onBack={() => setScreen({ name: 'HOME' })}
          />
        );
      case 'REPORT_CAPTURE':
        return (
          <ReportCaptureScreen
            user={user}
            reportType={screen.type}
            onBack={() => setScreen({ name: 'REPORT_TYPE' })}
            onSubmitted={handleReportSubmitted}
          />
        );
      case 'MY_REPORTS':
        return <MyReportsScreen reports={reports} onBack={() => setScreen({ name: 'HOME' })} />;
      default:
        return null;
    }
  };

  // History is kept in memory only for this hackathon build.

  return (
    <ServiceContext.Provider value={services}>
      <SafeAreaView style={styles.container}>
        <View style={styles.appShell}>{renderScreen()}</View>
        {user && (
          <BottomNav
            activeTab={currentTab}
            onPressHome={() => setScreen({ name: 'HOME' })}
            onPressReport={() => setScreen({ name: 'REPORT_TYPE' })}
            onPressMyReports={() => setScreen({ name: 'MY_REPORTS' })}
          />
        )}
      </SafeAreaView>
    </ServiceContext.Provider>
  );
};

// ================== Sign-up & Identity Verification ==================

const normalizeIcDigits = (value: string) => value.replace(/\D/g, '').slice(0, 12);

const formatIcNumber = (digits: string) => {
  if (digits.length <= 6) return digits;
  if (digits.length <= 8) {
    return `${digits.slice(0, 6)}-${digits.slice(6)}`;
  }
  return `${digits.slice(0, 6)}-${digits.slice(6, 8)}-${digits.slice(8, 12)}`;
};

const isValidIcFormat = (formatted: string) => /^\d{6}-\d{2}-\d{4}$/.test(formatted);

interface SignUpScreenProps {
  onSignedIn(user: User): void;
}

const SignUpScreen: React.FC<SignUpScreenProps> = ({ onSignedIn }) => {
  const { authService } = useServices();

  const [name, setName] = useState('');
  const [icNumber, setIcNumber] = useState('');
  const [icFrontUri, setIcFrontUri] = useState<string | null>(null);
  const [icBackUri, setIcBackUri] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const icIsValid = isValidIcFormat(icNumber);

  const canSubmit =
    name.trim().length > 0 &&
    icIsValid &&
    icFrontUri &&
    icBackUri &&
    !isLoading;

  const handleIcChange = (value: string) => {
    const digits = normalizeIcDigits(value);
    const formatted = formatIcNumber(digits);
    setIcNumber(formatted);
  };

  const captureIcImage = async (side: 'front' | 'back') => {
    try {
      const response: ImagePickerResponse = await launchCamera({
        mediaType: 'photo',
        cameraType: 'back',
        quality: 0.8,
      });

      if (response.didCancel || !response.assets || !response.assets[0]?.uri) {
        return;
      }

      const uri = response.assets[0].uri;
      if (side === 'front') setIcFrontUri(uri);
      else setIcBackUri(uri);
    } catch (e) {
      Alert.alert('Camera error', 'Unable to open camera. Please try again.');
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit || !icFrontUri || !icBackUri) return;
    try {
      setIsLoading(true);
      const user = await authService.signUpAndVerify({
        name: name.trim(),
        icNumber: icNumber.trim(),
        icFrontUri,
        icBackUri,
      });
      onSignedIn(user);
    } catch (e) {
      Alert.alert('Sign up failed', 'Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.appTitle}>OneSnap</Text>
      <Text style={styles.subtitle}>Smart City Issue Reporting</Text>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Create account</Text>

        <Text style={styles.label}>Full Name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="As per IC"
          style={styles.input}
          placeholderTextColor="#FFFFFF88"
        />

        <Text style={styles.label}>IC Number</Text>
        <TextInput
          value={icNumber}
          onChangeText={handleIcChange}
          placeholder="e.g. 990101-14-5678"
          style={styles.input}
          keyboardType="numeric"
          placeholderTextColor="#FFFFFF88"
        />
        {icNumber.length > 0 && !icIsValid && (
          <Text style={styles.errorText}>Invalid IC format. Example: 990101-01-1234</Text>
        )}

        <Text style={styles.label}>Scan IC</Text>
        <View style={styles.row}>
          <ScanButton
            label={icFrontUri ? 'Front captured' : 'Scan front'}
            onPress={() => captureIcImage('front')}
            filled={!!icFrontUri}
          />
          <ScanButton
            label={icBackUri ? 'Back captured' : 'Scan back'}
            onPress={() => captureIcImage('back')}
            filled={!!icBackUri}
          />
        </View>

        {(icFrontUri || icBackUri) && (
          <View style={styles.icPreviewRow}>
            {icFrontUri && (
              <View style={styles.icPreviewItem}>
                <Image source={{ uri: icFrontUri }} style={styles.icPreviewImage} />
                <Text style={styles.icPreviewLabel}>Front</Text>
              </View>
            )}
            {icBackUri && (
              <View style={styles.icPreviewItem}>
                <Image source={{ uri: icBackUri }} style={styles.icPreviewImage} />
                <Text style={styles.icPreviewLabel}>Back</Text>
              </View>
            )}
          </View>
        )}

        <TouchableOpacity
          style={[styles.primaryButton, !canSubmit && styles.buttonDisabled]}
          disabled={!canSubmit}
          onPress={handleSubmit}
        >
          {isLoading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryButtonText}>Verify & Continue</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.helperText}>
          Your identity is used to prevent spam and ensure accountable reporting.
        </Text>
      </View>
    </View>
  );
};

interface ScanButtonProps {
  label: string;
  onPress(): void;
  filled?: boolean;
}

const ScanButton: React.FC<ScanButtonProps> = ({ label, onPress, filled }) => (
  <TouchableOpacity
    onPress={onPress}
    style={[styles.outlineButton, filled && styles.outlineButtonFilled]}
  >
    <Text style={[styles.outlineButtonText, filled && styles.outlineButtonTextFilled]}>
      {label}
    </Text>
  </TouchableOpacity>
);

// ================== Home Screen ==================

interface HomeScreenProps {
  user: User;
  onStartReport(): void;
}

const HomeScreen: React.FC<HomeScreenProps> = ({ user, onStartReport }) => {
  return (
    <View style={styles.screen}>
      <Text style={styles.appTitle}>OneSnap</Text>
      <Text style={styles.welcomeText}>Welcome, {user.name} !</Text>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Report an issue</Text>
        <Text style={styles.helperText}>
          Snap once, we handle the rest. Severity and GPS are attached automatically.
        </Text>

        <TouchableOpacity style={styles.primaryButton} onPress={onStartReport}>
          <Text style={styles.primaryButtonText}>Start new report</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ================== Report Type Selection ==================

interface ReportTypeScreenProps {
  onSelectType(type: ReportType): void;
  onBack(): void;
}

const ReportTypeScreen: React.FC<ReportTypeScreenProps> = ({ onSelectType, onBack }) => {
  return (
    <View style={styles.screen}>
      <Text style={styles.appTitle}>New Report</Text>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>What are you reporting?</Text>

        <TypeButton label="Pothole" onPress={() => onSelectType('POTHOLE')} />
        <TypeButton label="Excessive Trash Disposal " onPress={() => onSelectType('TRASH')} />
        <TypeButton label="Public Facility Vandalism" onPress={() => onSelectType('VANDALISM')} />

        <TouchableOpacity style={styles.secondaryButton} onPress={onBack}>
          <Text style={styles.secondaryButtonText}>Back</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

interface TypeButtonProps {
  label: string;
  onPress(): void;
}

const TypeButton: React.FC<TypeButtonProps> = ({ label, onPress }) => (
  <TouchableOpacity style={styles.typeButton} onPress={onPress}>
    <Text style={styles.typeButtonText}>{label}</Text>
  </TouchableOpacity>
);

// ================== Report Capture & Submit ==================

interface ReportCaptureScreenProps {
  user: User;
  reportType: ReportType;
  onBack(): void;
  onSubmitted(report: SubmittedReport): void;
}

const ReportCaptureScreen: React.FC<ReportCaptureScreenProps> = ({
  user,
  reportType,
  onBack,
  onSubmitted,
}) => {
  const { locationService, aiModelService, reportService } = useServices();

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);

  const readableType =
    reportType === 'POTHOLE' ? 'Pothole' : reportType === 'TRASH' ? 'Trash' : 'Vandalism';

  const captureReportPhoto = async () => {
    try {
      const response: ImagePickerResponse = await launchCamera({
        mediaType: 'photo',
        cameraType: 'back',
        quality: 0.8,
        includeBase64: true,
      });

      if (response.didCancel || !response.assets || !response.assets[0]?.uri) {
        return;
      }

      const asset = response.assets[0];
      setPhotoUri(asset.uri || null);
      setPhotoBase64(asset.base64 || null);
    } catch (e) {
      Alert.alert('Camera error', 'Unable to open camera. Please try again.');
    }
  };

  const pickReportPhotoFromLibrary = async () => {
    try {
      const response: ImagePickerResponse = await launchImageLibrary({
        mediaType: 'photo',
        quality: 0.8,
        includeBase64: true,
      });

      if (response.didCancel || !response.assets || !response.assets[0]?.uri) {
        return;
      }

      const asset = response.assets[0];
      setPhotoUri(asset.uri || null);
      setPhotoBase64(asset.base64 || null);
    } catch (e) {
      Alert.alert('Gallery error', 'Unable to open gallery. Please try again.');
    }
  };

  const handleSubmit = async () => {
    if (!photoUri || isSubmitting) return;
    try {
      setIsSubmitting(true);

      const location = await locationService.getCurrentLocation();
      const { severity, confidence } = await aiModelService.inferSeverity(
        photoBase64 || '',
        reportType
      );
      setAiExplanation(
        `AI ranked this as ${severity.toLowerCase()} priority (confidence ${Math.round(confidence * 100)
        }%).`
      );

      if (reportType === 'VANDALISM' && severity !== 'LOW') {
        Vibration.vibrate([0, 200, 100, 200]);
        Alert.alert(
          'Vandalism detected',
          `AI detected possible vandalism with ${Math.round(confidence * 100)}% confidence.`
        );
      }

      const payload: ReportPayload = {
        reporter: user,
        type: reportType,
        photoUri,
        photoBase64: photoBase64 || undefined,
        location,
        description: description.trim(),
        severity,
        createdAt: new Date().toISOString(),
      };

      await reportService.submitReport(payload);
      Alert.alert('Report submitted', 'Thank you for improving your city.');
      const submitted: SubmittedReport = {
        ...payload,
        id: `rep-${Date.now()}`,
        status: 'PENDING',
      };
      onSubmitted(submitted);
    } catch (e) {
      Alert.alert('Error', 'Unable to submit report. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.appTitle}>Capture {readableType}</Text>

      <View style={styles.card}>
        <View style={styles.previewBox}>
          {photoUri ? (
            <Image
              source={{ uri: photoUri }}
              style={styles.previewImage}
            />
          ) : (
            <Text style={styles.previewPlaceholder}>No photo yet</Text>
          )}
        </View>

        <TouchableOpacity style={styles.primaryButton} onPress={captureReportPhoto}>
          <Text style={styles.primaryButtonText}>
            {photoUri ? 'Retake photo' : 'Snap photo'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.textLinkButton} onPress={pickReportPhotoFromLibrary}>
          <Text style={styles.textLinkButtonText}>Or choose from gallery</Text>
        </TouchableOpacity>

        <Text style={styles.label}>Describe the issue</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          style={styles.textArea}
          placeholder="Eg. Large pothole on left lane causing cars to swerve."
          placeholderTextColor="#FFFFFF88"
          multiline
        />

        <TouchableOpacity
          style={[styles.primaryButton, (!photoUri || isSubmitting) && styles.buttonDisabled]}
          disabled={!photoUri || isSubmitting}
          onPress={handleSubmit}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryButtonText}>Submit report</Text>
          )}
        </TouchableOpacity>

        {aiExplanation && <Text style={styles.helperText}>{aiExplanation}</Text>}

        <TouchableOpacity style={styles.secondaryButton} onPress={onBack}>
          <Text style={styles.secondaryButtonText}>Back</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ================== My Reports Screen ==================

interface MyReportsScreenProps {
  reports: SubmittedReport[];
  onBack(): void;
}

const MyReportsScreen: React.FC<MyReportsScreenProps> = ({ reports, onBack }) => {
  return (
    <View style={styles.screen}>
      <Text style={styles.appTitle}>My reports</Text>
      <View style={styles.card}>
        {reports.length === 0 ? (
          <Text style={styles.helperText}>You have not submitted any reports yet.</Text>
        ) : (
          reports.map((report) => {
            const created = new Date(report.createdAt);
            const readableType =
              report.type === 'POTHOLE'
                ? 'Pothole'
                : report.type === 'TRASH'
                  ? 'Trash'
                  : 'Vandalism';
            return (
              <View key={report.id} style={styles.reportItem}>
                <View style={styles.reportRow}>
                  <Text style={styles.reportTitle}>{readableType}</Text>
                  <View
                    style={[
                      styles.statusBadge,
                      report.status === 'PENDING'
                        ? styles.statusPending
                        : report.status === 'IN_PROGRESS'
                          ? styles.statusInProgress
                          : styles.statusResolved,
                    ]}
                  >
                    <Text style={styles.statusBadgeText}>
                      {report.status === 'PENDING'
                        ? 'Pending'
                        : report.status === 'IN_PROGRESS'
                          ? 'In progress'
                          : 'Resolved'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.reportMeta}>
                  {created.toLocaleDateString()} • {created.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
                <Text style={styles.reportMeta}>
                  Severity Level from AI: {report.severity.charAt(0) + report.severity.slice(1).toLowerCase()}
                </Text>
                <Text style={styles.reportMeta}>
                  Location:{' '}
                  {report.location.address
                    ? report.location.address
                    : `${report.location.latitude.toFixed(5)}, ${report.location.longitude.toFixed(5)}`}
                </Text>
                {report.description ? (
                  <Text style={styles.reportMeta} numberOfLines={2}>
                    "{report.description}"
                  </Text>
                ) : null}
              </View>
            );
          })
        )}
        <TouchableOpacity style={styles.secondaryButton} onPress={onBack}>
          <Text style={styles.secondaryButtonText}>Back</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ================== Bottom Navigation ==================

interface BottomNavProps {
  activeTab: 'HOME' | 'REPORT' | 'MY_REPORTS';
  onPressHome(): void;
  onPressReport(): void;
  onPressMyReports(): void;
}

const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onPressHome,
  onPressReport,
  onPressMyReports,
}) => {
  return (
    <View style={styles.bottomNav}>
      <TouchableOpacity
        style={[
          styles.bottomNavItem,
          activeTab === 'HOME' && styles.bottomNavItemActive,
        ]}
        onPress={onPressHome}
        accessibilityLabel="Home"
      >
        <Text
          style={[
            styles.bottomNavText,
            activeTab === 'HOME' && styles.bottomNavTextActive,
          ]}
        >
          Home
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[
          styles.bottomNavItem,
          activeTab === 'REPORT' && styles.bottomNavItemActive,
        ]}
        onPress={onPressReport}
        accessibilityLabel="New report"
      >
        <Text
          style={[
            styles.bottomNavText,
            activeTab === 'REPORT' && styles.bottomNavTextActive,
          ]}
        >
          Report
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[
          styles.bottomNavItem,
          activeTab === 'MY_REPORTS' && styles.bottomNavItemActive,
        ]}
        onPress={onPressMyReports}
        accessibilityLabel="My reports"
      >
        <Text
          style={[
            styles.bottomNavText,
            activeTab === 'MY_REPORTS' && styles.bottomNavTextActive,
          ]}
        >
          My reports
        </Text>
      </TouchableOpacity>
    </View>
  );
};

// ================== Styles ==================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1721',
  },
  appShell: {
    flex: 1,
  },
  screen: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  appTitle: {
    fontSize: 28,
    fontWeight: '700',
    fontFamily: 'sans-serif',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    fontFamily: 'sans-serif',
    color: '#A0B4C8',
    marginBottom: 16,
  },
  welcomeText: {
    fontSize: 22,
    fontFamily: 'sans-serif',
    color: '#FFFFFF',
    marginBottom: 16,
  },
  card: {
    backgroundColor: '#101C28',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    fontFamily: 'sans-serif',
    color: '#FFFFFF',
    marginBottom: 12,
  },
  label: {
    fontSize: 16,
    fontFamily: 'sans-serif',
    color: '#A0B4C8',
    marginTop: 8,
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#1B2836',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'sans-serif',
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 8,
  },
  primaryButton: {
    backgroundColor: '#2F80ED',
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 16,
    fontFamily: 'sans-serif',
  },
  secondaryButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#32465B',
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  secondaryButtonText: {
    color: '#A0B4C8',
    fontSize: 15,
    fontFamily: 'sans-serif',
  },
  outlineButton: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#32465B',
    paddingVertical: 10,
    alignItems: 'center',
    marginRight: 4,
  },
  outlineButtonFilled: {
    backgroundColor: '#1B2836',
    borderColor: '#2F80ED',
  },
  outlineButtonText: {
    color: '#A0B4C8',
    fontSize: 14,
    fontFamily: 'sans-serif',
  },
  outlineButtonTextFilled: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  typeButton: {
    backgroundColor: '#1B2836',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 10,
    marginTop: 10,
  },
  typeButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'sans-serif',
  },
  helperText: {
    fontSize: 13,
    fontFamily: 'sans-serif',
    color: '#7F92A7',
    marginTop: 8,
  },
  textLinkButton: {
    alignItems: 'center',
    marginTop: 6,
  },
  textLinkButtonText: {
    fontSize: 13,
    fontFamily: 'sans-serif',
    color: '#A0B4C8',
    textDecorationLine: 'underline',
  },
  textArea: {
    backgroundColor: '#1B2836',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'sans-serif',
    minHeight: 80,
    textAlignVertical: 'top',
    marginTop: 8,
  },
  errorText: {
    fontSize: 13,
    fontFamily: 'sans-serif',
    color: '#FF6B6B',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  previewBox: {
    height: 180,
    borderRadius: 12,
    backgroundColor: '#1B2836',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  previewPlaceholder: {
    color: '#7F92A7',
    fontFamily: 'sans-serif',
  },
  previewImage: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  icPreviewRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginTop: 8,
    marginBottom: 4,
  },
  icPreviewItem: {
    marginRight: 10,
    alignItems: 'center',
  },
  icPreviewImage: {
    width: 80,
    height: 50,
    borderRadius: 8,
    backgroundColor: '#1B2836',
  },
  icPreviewLabel: {
    marginTop: 4,
    fontSize: 11,
    fontFamily: 'sans-serif',
    color: '#A0B4C8',
  },
  reportItem: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1E2A36',
  },
  reportRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  reportTitle: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'sans-serif',
    color: '#FFFFFF',
  },
  reportMeta: {
    fontSize: 13,
    fontFamily: 'sans-serif',
    color: '#A0B4C8',
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusBadgeText: {
    fontSize: 12,
    fontFamily: 'sans-serif',
    color: '#0B1721',
    fontWeight: '600',
  },
  statusPending: {
    backgroundColor: '#F2C94C',
  },
  statusInProgress: {
    backgroundColor: '#2D9CDB',
  },
  statusResolved: {
    backgroundColor: '#27AE60',
  },
  bottomNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1E2A36',
    backgroundColor: '#0B1721',
  },
  bottomNavItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 999,
  },
  bottomNavItemActive: {
    backgroundColor: 'rgba(47,128,237,0.15)',
  },
  bottomNavText: {
    fontSize: 13,
    fontFamily: 'sans-serif',
    color: '#7F92A7',
  },
  bottomNavTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
});

export default App;