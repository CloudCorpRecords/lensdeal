import { useEffect, useRef, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Route, Switch, Redirect, useLocation, Router as WouterRouter, Link } from 'wouter';
import { ScanSearch } from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Home from '@/pages/home';
import { Workspace, History, ReportDetail, Compilations, CompilationDetailPage, Plans } from '@/pages/platform';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
function stripBase(path: string): string { return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path; }
if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  variables: {
    colorPrimary:'#425e3f', colorForeground:'#24372d', colorMutedForeground:'#657565',
    colorBackground:'#f9faf2', colorInput:'#f4f6eb', colorInputForeground:'#24372d',
    colorNeutral:'#a3af9f', colorDanger:'#ad5344', fontFamily:'DM Sans, sans-serif', borderRadius:'4px'
  },
  elements: {
    rootBox:'w-full flex justify-center', cardBox:'bg-[#f9faf2] rounded-md w-[440px] max-w-full overflow-hidden',
    card:'!shadow-none !border-0 !bg-transparent !rounded-none',
    footer:'!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle:'!hidden',
    headerSubtitle:'!hidden',
    socialButtonsBlockButton:'!border-[#b9c8b9] !text-[#24372d] !opacity-100',
    socialButtonsBlockButtonText:'!text-[#24372d] !opacity-100',
    formButtonPrimary:'!bg-[#3d5b38] !text-[#f9faf2]',
  },
};

function AuthPage({mode}:{mode:'in'|'up'}) {
  return <div className="auth-page"><div className="auth-story"><Link href="/" className="dl-logo" data-testid="link-auth-home"><span className="dl-logo-mark"><ScanSearch size={17}/></span>deallens.</Link><h1>Come prepared<br/>to <em>ask better.</em></h1><p>Research is a starting point. The real story comes from the people behind the business.</p></div><div className="auth-form"><div className="auth-form-inner"><span className="dl-eyebrow">{mode === 'in' ? 'Welcome back' : 'Create your research desk'}</span><h2 style={{fontSize:33,fontWeight:500,letterSpacing:'-.05em',margin:'12px 0 30px'}}>{mode === 'in' ? 'Pick up where you left off.' : 'Get a clearer first pass.'}</h2>{mode === 'in' ? <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} fallbackRedirectUrl={`${basePath}/workspace`}/> : <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} fallbackRedirectUrl={`${basePath}/workspace`}/>}<p className="desk-note" style={{marginTop:25}}>Traffic estimates are directional. Verify with seller-provided data.</p></div></div></div>;
}
function Protected({children}:{children:ReactNode}) { return <><Show when="signed-in">{children}</Show><Show when="signed-out"><Redirect to="/sign-in"/></Show></>; }
function Landing() { return <><Show when="signed-in"><Redirect to="/workspace"/></Show><Show when="signed-out"><Home/></Show></>; }
function CacheInvalidator() {
  const {addListener} = useClerk();
  const client = useQueryClient();
  const previous = useRef<string|null|undefined>(undefined);
  useEffect(() => {const unsubscribe = addListener(({user}) => {const id = user?.id ?? null;if (previous.current !== undefined && previous.current !== id) client.clear();previous.current = id;});return unsubscribe;},[addListener,client]);
  return null;
}
function RoutedErrorBoundary({children}:{children:ReactNode}) { const [location] = useLocation(); return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>; }
function Router() {
  return <RoutedErrorBoundary><Switch>
    <Route path="/" component={Landing}/>
    <Route path="/sign-in/*"><AuthPage mode="in"/></Route>
    <Route path="/sign-in"><AuthPage mode="in"/></Route>
    <Route path="/sign-up/*"><AuthPage mode="up"/></Route>
    <Route path="/sign-up"><AuthPage mode="up"/></Route>
    <Route path="/workspace"><Protected><Workspace/></Protected></Route>
    <Route path="/history"><Protected><History/></Protected></Route>
    <Route path="/history/:id"><Protected><ReportDetail/></Protected></Route>
    <Route path="/compilations"><Protected><Compilations/></Protected></Route>
    <Route path="/compilations/:id"><Protected><CompilationDetailPage/></Protected></Route>
    <Route path="/plans"><Protected><Plans/></Protected></Route>
    <Route component={NotFound}/>
  </Switch></RoutedErrorBoundary>;
}
function ClerkApp() {
  const [,setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} routerPush={(path:string) => setLocation(stripBase(path))} routerReplace={(path:string) => setLocation(stripBase(path),{replace:true})}>
    <QueryClientProvider client={queryClient}><TooltipProvider><CacheInvalidator/><Router/><Toaster/></TooltipProvider></QueryClientProvider>
  </ClerkProvider>;
}
function App() { return <WouterRouter base={basePath}><ClerkApp/></WouterRouter>; }
export default App;