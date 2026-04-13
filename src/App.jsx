import SmartIntake from "./components/SmartIntakeV6";

export default function App() {
  return <SmartIntake onComplete={(data) => console.log("Blueprint complete:", data)} />;
}
