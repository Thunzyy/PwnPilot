import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthStore } from "@/stores/authStore";

export function AuthScreen() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { login, signup, isLoading, error } = useAuthStore();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (mode === "login") {
      await login(username, password);
      return;
    }
    await signup(username, email, password);
  };

  return (
    <div className="min-h-screen bg-[#0b0f17] text-slate-200 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-[#252b3a] bg-[#121722] p-8 shadow-2xl">
        <h1 className="text-2xl font-black text-white tracking-tight">
          {mode === "login" ? "Sign in" : "Create account"}
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          {mode === "login"
            ? "Access your cockpit"
            : "Start a new operator profile"}
        </p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-3">
          <Input
            placeholder="Username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          {mode === "signup" && (
            <Input
              placeholder="Email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
          <Input
            placeholder="Password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <Button type="submit" disabled={isLoading} className="w-full">
            {isLoading ? "Working..." : mode === "login" ? "Sign in" : "Sign up"}
          </Button>
        </form>
        <button
          type="button"
          onClick={() => setMode(mode === "login" ? "signup" : "login")}
          className="mt-4 text-xs text-primary hover:underline"
        >
          {mode === "login" ? "Need an account?" : "Already have an account?"}
        </button>
      </div>
    </div>
  );
}
