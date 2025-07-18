// src/contexts/CartContext.tsx

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { useToast } from "@/components/ui/use-toast";
import { apiFetch, cartApi, orderApi } from "@/lib/api";

// --- Interfaces ---

// Represents an item within the cart state
export interface CartItem {
  id: string; // The ID of the cart item itself (from the cart collection)
  productId: string; // The ID of the product
  name: string;
  price: number;
  image: string;
  quantity: number;
}

// Represents the details needed to create an order
export interface OrderDetails {
  recipientName: string;
  phone: string;
  shippingAddress: string;
  note: string;
  paymentMethod?: string;
}

// Defines the shape of the context's value, available to consumers
interface CartContextType {
  cartItems: CartItem[];
  setCartItems: React.Dispatch<React.SetStateAction<CartItem[]>>;
  addToCart: (
    item: { id: string; name: string; price: number; image: string },
    quantity?: number
  ) => void;
  updateQuantity: (id: string, change: number) => void;
  removeItem: (id: string) => void;
  clearCart: () => void;
  refreshCart: () => Promise<void>;
  forceRefresh: () => Promise<void>;
  subtotal: number;
  itemCount: number;
  isCartLoading: boolean;
  isSubmitting: boolean;
  submitOrder: (details: OrderDetails) => Promise<void>;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

// Using centralized API functions from /lib/api.ts

export const CartProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const { toast } = useToast();
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [isCartLoading, setIsCartLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [refreshTimeout, setRefreshTimeout] = useState<NodeJS.Timeout | null>(
    null
  );

  // Extract fetchCart as a reusable function
  const fetchCart = async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      setCartItems([]);
      localStorage.removeItem("cart");
      return;
    }

    try {
      setIsCartLoading(true);
      // Use cartApi for consistent API calls
      const cartData = await cartApi.getCart();
      const mappedItems = (cartData.items || [])
        .map((item: any) => {
          if (!item.product && !item.productId) return null; // Bỏ qua item lỗi/null
          let image =
            (item.product?.images?.length && item.product.images[0]?.url) ||
            (item.productId?.images?.length && item.productId.images[0]?.url) ||
            item.image ||
            "/placeholder.png";
          return {
            id: item._id,
            productId:
              item.product?._id ||
              (typeof item.productId === "object"
                ? item.productId._id
                : item.productId) ||
              "",
            name: item.product?.name || item.productId?.name || item.name || "",
            price:
              item.product?.price ||
              item.productId?.price ||
              item.unitPrice ||
              item.price ||
              0,
            image,
            quantity: item.quantity,
          };
        })
        .filter(Boolean); // Bỏ các item null
      setCartItems(mappedItems);
      // Always update localStorage with server data
      if (mappedItems.length === 0) {
        localStorage.removeItem("cart");
      } else {
        localStorage.setItem("cart", JSON.stringify(mappedItems));
      }
    } catch (error) {
      console.error("Failed to fetch cart:", error);
      setCartItems([]);
      localStorage.removeItem("cart");
    } finally {
      setIsCartLoading(false);
    }
  };

  useEffect(() => {
    fetchCart();
  }, [localStorage.getItem("token")]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (refreshTimeout) {
        clearTimeout(refreshTimeout);
      }
    };
  }, [refreshTimeout]);

  const addToCart = async (
    product: { id: string; name: string; price: number; image: string },
    quantity: number = 1
  ) => {
    const existingItem = cartItems.find(
      (item) => item.productId === product.id
    );

    // If item already exists, just update its quantity by calling updateQuantity with the CHANGE in quantity
    if (existingItem) {
      const newQuantity = existingItem.quantity + quantity;
      await updateQuantity(
        existingItem.id,
        newQuantity - existingItem.quantity
      ); // Pass the change, not the new total
      return;
    }

    // Optimistic UI: Add a temporary item to the cart immediately
    const tempId = `temp-${Date.now()}`;
    const newItem: CartItem = {
      id: tempId,
      productId: product.id,
      name: product.name,
      price: product.price,
      image: product.image,
      quantity,
    };
    const previousCart = [...cartItems];
    setCartItems((prev) => [...prev, newItem]);
    toast({
      title: "Added to cart",
      description: `${product.name} has been added.`,
    });

    // Call API in the background
    try {
      const addedItemData = await cartApi.addItem(product.id, quantity);
      // Replace the temporary item with the real one from the server
      setCartItems((prev) =>
        prev.map((item) =>
          item.id === tempId ? { ...newItem, id: addedItemData.item._id } : item
        )
      );
    } catch (error) {
      toast({
        title: "Error",
        description: "Could not add item to cart.",
        variant: "destructive",
      });
      setCartItems(previousCart); // Revert on failure
    }
  };

  const updateQuantity = async (itemId: string, change: number) => {
    const previousCart = [...cartItems];
    let newQuantity = 0;

    const updatedCart = previousCart
      .map((item) => {
        if (item.id === itemId) {
          newQuantity = item.quantity + change;
          return { ...item, quantity: newQuantity };
        }
        return item;
      })
      .filter((item) => item.quantity > 0); // Filter out items with quantity 0 or less

    // Optimistic UI Update
    setCartItems(updatedCart);

    if (newQuantity < 1) {
      // If item is removed, call DELETE API
      try {
        await cartApi.removeItem(itemId);
        toast({ title: "Item removed", variant: "destructive" });
      } catch (error) {
        toast({
          title: "Error",
          description: "Could not remove item from cart.",
          variant: "destructive",
        });
        setCartItems(previousCart); // Revert on failure
      }
    } else {
      // If quantity is updated, call PATCH API
      try {
        await cartApi.updateItem(itemId, newQuantity);
      } catch (error) {
        toast({
          title: "Error",
          description: "Could not update item quantity.",
          variant: "destructive",
        });
        setCartItems(previousCart); // Revert on failure
      }
    }
  };

  const removeItem = async (itemId: string) => {
    const previousCart = [...cartItems];
    // Optimistic UI: Remove item immediately
    setCartItems((prev) => prev.filter((item) => item.id !== itemId));
    toast({ title: "Item removed", variant: "destructive" });

    try {
      await cartApi.removeItem(itemId);
    } catch (error) {
      toast({
        title: "Error",
        description: "Could not remove item from cart.",
        variant: "destructive",
      });
      setCartItems(previousCart); // Revert on failure
    }
  };

  const clearCart = async () => {
    const previousCart = [...cartItems];
    setCartItems([]); // Optimistic update
    try {
      // Use cartApi for consistent API calls
      await cartApi.clearCart();
      console.log("Cart cleared successfully");
    } catch (error) {
      console.error("Failed to clear cart:", error);
      toast({
        title: "Error",
        description: "Could not clear the cart.",
        variant: "destructive",
      });
      setCartItems(previousCart); // Revert on failure
    }
  };

  const submitOrder = async (details: OrderDetails) => {
    if (cartItems.length === 0) {
      throw new Error("Cannot submit order with an empty cart.");
    }

    const userString = localStorage.getItem("user");
    if (!userString) {
      throw new Error("User not logged in");
    }
    const user = JSON.parse(userString);
    // Use user.id (account ID) to match backend cart logic
    const customerId = user.id;

    setIsSubmitting(true);
    try {
      // Create the complete order payload
      const orderData = {
        customerId,
        ...details, // Spread the recipient's details (name, phone, address, etc.)

        // Map the cart items to the format required by the backend API
        items: cartItems.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.price,
        })),
      };

      const result = await orderApi.createOrder(orderData);

      // After successful order, immediately clear cart state
      console.log("Order created successfully, clearing cart...");
      setCartItems([]);
      localStorage.removeItem("cart");

      // Add a small delay to ensure backend has cleared the cart
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Refresh cart from server to ensure sync
      await fetchCart();
      console.log("Cart cleared and refreshed after order creation");

      return result;
    } finally {
      setIsSubmitting(false);
    }
  };

  // Calculated values derived from state
  const subtotal = cartItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );
  const itemCount = cartItems.reduce((count, item) => count + item.quantity, 0);

  // The value provided to consumers of the context
  const contextValue: CartContextType = {
    cartItems,
    setCartItems,
    addToCart,
    updateQuantity,
    removeItem,
    clearCart,
    refreshCart: fetchCart, // Expose fetchCart as refreshCart
    forceRefresh: async () => {
      // Clear any pending refresh timeout
      if (refreshTimeout) {
        clearTimeout(refreshTimeout);
        setRefreshTimeout(null);
      }

      console.log("Force refreshing cart...");

      // Immediately clear local state
      setCartItems([]);
      localStorage.removeItem("cart");

      // Add a small delay to ensure backend has processed the order
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Fetch fresh data from server
      try {
        await fetchCart();
        console.log("Cart force refresh completed");
      } catch (error) {
        console.error("Failed to force refresh cart:", error);
      }
    },
    subtotal,
    itemCount, // Provide itemCount
    submitOrder,
    isSubmitting,
    isCartLoading,
  };

  return (
    <CartContext.Provider value={contextValue}>{children}</CartContext.Provider>
  );
};

// Custom hook for easy consumption of the cart context
export const useCart = () => {
  const context = useContext(CartContext);
  if (context === undefined) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return context;
};

// Lưu ý bảo mật:
// Nếu bạn lưu token vào localStorage, token có thể bị truy cập bởi bất kỳ JavaScript nào chạy trên trang web của bạn (bao gồm cả các script của bên thứ ba nếu bị chèn vào).
// Điều này có thể dẫn đến nguy cơ bị đánh cắp token nếu website bị XSS (Cross-Site Scripting).
// Để bảo mật tốt hơn, nên lưu token ở httpOnly cookie phía server (token sẽ không bị truy cập bởi JavaScript).
// Tuy nhiên, nếu bạn chỉ làm ứng dụng client-side và không kiểm soát backend, việc lưu token ở localStorage là chấp nhận được nhưng phải đảm bảo không có lỗ hổng XSS trên trang web của bạn.
