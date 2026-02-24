import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuthStore } from '../../store/authStore'
import { Eye, EyeOff, UserPlus } from 'lucide-react'

const registerSchema = z
    .object({
        name: z.string().min(2, 'Name must be at least 2 characters').max(100),
        email: z.string().email('Please enter a valid email address'),
        password: z
            .string()
            .min(8, 'Password must be at least 8 characters')
            .regex(/[A-Z]/, 'Must contain an uppercase letter')
            .regex(/[a-z]/, 'Must contain a lowercase letter')
            .regex(/[0-9]/, 'Must contain a number'),
        confirmPassword: z.string(),
    })
    .refine((data) => data.password === data.confirmPassword, {
        message: 'Passwords do not match',
        path: ['confirmPassword'],
    })

type RegisterForm = z.infer<typeof registerSchema>

const Register = () => {
    const navigate = useNavigate()
    const registerUser = useAuthStore((state) => state.register)
    const [showPassword, setShowPassword] = useState(false)
    const [showConfirm, setShowConfirm] = useState(false)

    const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting },
    } = useForm<RegisterForm>({
        resolver: zodResolver(registerSchema),
    })

    const onSubmit = async (data: RegisterForm) => {
        try {
            await registerUser({
                name: data.name,
                email: data.email,
                password: data.password,
                confirmPassword: data.confirmPassword,
            })
            toast.success('Account created! Please check your email to verify.')
            navigate('/dashboard')
        } catch (error: any) {
            const message =
                error.response?.data?.message || 'Registration failed. Please try again.'
            toast.error(message)
        }
    }

    /** Password strength indicator */
    const password = register('password')
    const getStrength = (val: string) => {
        let s = 0
        if (val.length >= 8) s++
        if (/[A-Z]/.test(val)) s++
        if (/[a-z]/.test(val)) s++
        if (/[0-9]/.test(val)) s++
        if (/[^A-Za-z0-9]/.test(val)) s++
        return s
    }

    const [strength, setStrength] = useState(0)

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
            <div className="bg-white p-8 rounded-xl shadow-xl w-full max-w-md border border-gray-200">
                <div className="text-center mb-8">
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
                        <UserPlus className="h-6 w-6 text-blue-600" />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900">Create Account</h1>
                    <p className="text-gray-500 mt-2">Join Meeting Assistant to collaborate</p>
                </div>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                    {/* Name */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                        <input
                            {...register('name')}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                            placeholder="Jane Doe"
                        />
                        {errors.name && (
                            <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>
                        )}
                    </div>

                    {/* Email */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                        <input
                            {...register('email')}
                            type="email"
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                            placeholder="you@company.com"
                        />
                        {errors.email && (
                            <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>
                        )}
                    </div>

                    {/* Password */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                        <div className="relative">
                            <input
                                {...password}
                                onChange={(e) => {
                                    password.onChange(e)
                                    setStrength(getStrength(e.target.value))
                                }}
                                type={showPassword ? 'text' : 'password'}
                                className="w-full px-4 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                placeholder="••••••••"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>
                        {/* Strength bar */}
                        <div className="mt-1.5 flex gap-1">
                            {[1, 2, 3, 4, 5].map((i) => (
                                <div
                                    key={i}
                                    className={`h-1 flex-1 rounded-full transition-colors ${strength >= i
                                            ? strength <= 2
                                                ? 'bg-red-400'
                                                : strength <= 3
                                                    ? 'bg-yellow-400'
                                                    : 'bg-green-400'
                                            : 'bg-gray-200'
                                        }`}
                                />
                            ))}
                        </div>
                        {errors.password && (
                            <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>
                        )}
                    </div>

                    {/* Confirm Password */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Confirm Password
                        </label>
                        <div className="relative">
                            <input
                                {...register('confirmPassword')}
                                type={showConfirm ? 'text' : 'password'}
                                className="w-full px-4 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                placeholder="••••••••"
                            />
                            <button
                                type="button"
                                onClick={() => setShowConfirm(!showConfirm)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>
                        {errors.confirmPassword && (
                            <p className="text-red-500 text-xs mt-1">{errors.confirmPassword.message}</p>
                        )}
                    </div>

                    {/* Submit */}
                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {isSubmitting ? 'Creating account...' : 'Create Account'}
                    </button>
                </form>

                <p className="mt-6 text-center text-sm text-gray-600">
                    Already have an account?{' '}
                    <Link to="/login" className="text-blue-600 font-medium hover:underline">
                        Sign in
                    </Link>
                </p>
            </div>
        </div>
    )
}

export default Register
