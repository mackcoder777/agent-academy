import SmartIntake from "./components/SmartIntake";

export default function App() {
  return <SmartIntake onComplete={(data) => console.log("Blueprint complete:", data)} />;
}
