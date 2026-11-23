import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Explore from './pages/Explore';
import DestinationDetail from './pages/DestinationDetail';
import Plan from './pages/Plan';
import TripDetail from './pages/TripDetail';
import MyTrips from './pages/MyTrips';
import Hotels from './pages/Hotels';
import CuratedHotels from './pages/CuratedHotels';
import HotelDetail from './pages/HotelDetail';
import Restaurants from './pages/Restaurants';
import CuratedRestaurants from './pages/CuratedRestaurants';
import RestaurantDetail from './pages/RestaurantDetail';
import Nearby from './pages/Nearby';
import Attractions from './pages/Attractions';
import AttractionDetail from './pages/AttractionDetail';
import Guides from './pages/Guides';
import GuideDetail from './pages/GuideDetail';
import History from './pages/History';
import Profile from './pages/Profile';
import Passport from './pages/Passport';
import Budget from './pages/Budget';
import Login from './pages/Login';
import Register from './pages/Register';
import NotFound from './pages/NotFound';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/explore" element={<Explore />} />
        <Route path="/explore/:slug" element={<DestinationDetail />} />
        <Route path="/plan" element={<Plan />} />
        <Route path="/trips" element={<MyTrips />} />
        <Route path="/trips/:id" element={<TripDetail />} />
        <Route path="/share/:token" element={<TripDetail shared />} />
        <Route path="/hotels" element={<Hotels />} />
        <Route path="/hotels/curated" element={<CuratedHotels />} />
        <Route path="/hotels/:slug" element={<HotelDetail />} />
        <Route path="/restaurants" element={<Restaurants />} />
        <Route path="/restaurants/curated" element={<CuratedRestaurants />} />
        <Route path="/restaurants/:slug" element={<RestaurantDetail />} />
        <Route path="/nearby" element={<Nearby />} />
        <Route path="/attractions" element={<Attractions />} />
        <Route path="/attractions/:slug" element={<AttractionDetail />} />
        <Route path="/guides" element={<Guides />} />
        <Route path="/guides/:slug" element={<GuideDetail />} />
        <Route path="/history" element={<History />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/passport" element={<Passport />} />
        <Route path="/budget" element={<Budget />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}
