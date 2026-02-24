import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import apiClient from '../../api/axios.config'
import { KeyRound, ArrowLeft, CheckCircle2 } from 'lucide-react'

const forgotSchema = z.object({
    email: z.string().email('Please enter a valid email address'),
})

const resetSchema = z
    .object({
        token: z.string().min(1, 'Reset token is required'),
        password: z
            .string()
            .min(8, 'Password must be at least 8 characters')
            .regex(/[A-Z]/, 'Must contain an uppercase letter')
            .regex(/[a-z]/, 'Must contain a lowercase letter')
            .regex(/[0-9]/, 'Must contain a number'),
        confirmPassword: z.string(),
    })
    .refine((d) => d.password === d.confirmPassword, {
        message: 'Passwords do not match',
        path: ['confirmPassword'],
    })

type ForgotForm = z.infer<typeof forgotSchema>
type ResetForm = z.infer<typeof resetSchema>

type Step = 'request' | 'reset' | 'done'

const ForgotPassword = () => {
    const [step, setStep] = useState<Step>('request')

    // --- Request form ---
    const requestForm = useForm<ForgotForm>({ resolver: zodResolver(forgotSchema) })

    const onRequestSubmit = async (data: ForgotForm) => {
        try {
            await apiClient.post('/auth/forgot-password', data)
            toast.success('If an account exists, a reset link has been sent.')
            setStep('reset')
        } catch (error: any) {
            toast.error(error.response?.data?.message || 'Something went wrong')
        }
    }

    // --- Reset form ---
    const resetForm = useForm<ResetForm>({ resolver: zodResolver(resetSchema) })

    const onResetSubmit = async (data: ResetForm) => {
        try {
            await apiClient.post('/auth/reset-password', data)
            toast.success('Password reset successfully!')
            setStep('done')
        } catch (error: any) {
            toast.error(error.response?.data?.message || 'Invalid or expired token')
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
            <div className="bg-white p-8 rounded-xl shadow-xl w-full max-w-md border border-gray-200">
                {/* ── Step 1: Request reset ── */}
                {step === 'request' && (
                    <>
                        <div className="text-center mb-8">
                            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
                                <KeyRound className="h-6 w-6 text-amber-600" />
                            </div>
                            <h1 className="text-2xl font-bold text-gray-900">Forgot Password</h1>
                            <p className="text-gray-500 mt-2">
                                Enter your email and we&apos;ll send a reset link
                            </p>
                        </div>

                        <form onSubmit={requestForm.handleSubmit(onRequestSubmit)} className="space-y-5">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Email Address
                                </label>
                                <input
                                    {...requestForm.register('email')}
                                    type="email"
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                    placeholder="you@company.com"
                                />
                                {requestForm.formState.errors.email && (
                                    <p className="text-red-500 text-xs mt-1">
                                        {requestForm.formState.errors.email.message}
                                    </p>
                                )}
                            </div>

                            <button
                                type="submit"
                                disabled={requestForm.formState.isSubmitting}
                                className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {requestForm.formState.isSubmitting ? 'Sending...' : 'Send Reset Link'}
                            </button>
                        </form>

                        <p className="mt-6 text-center text-sm">
                            <Link
                                to="/login"
                                className="inline-flex items-center gap-1 text-blue-600 font-medium hover:underline"
                            >
                                <ArrowLeft size={14} /> Back to Login
                            </Link>
                        </p>
                    </>
                )}

                {/* ── Step 2: Enter token + new password ── */}
                {step === 'reset' && (
                    <>
                        <div className="text-center mb-8">
                            <h1 className="text-2xl font-bold text-gray-900">Reset Password</h1>
                            <p className="text-gray-500 mt-2">
                                Paste the token from your email and choose a new password
                            </p>
                        </div>

                        <form onSubmit={resetForm.handleSubmit(onResetSubmit)} className="space-y-5">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Reset Token
                                </label>
                                <input
                                    {...resetForm.register('token')}
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm"
                                    placeholder="Paste the token from your email"
                                />
                                {resetForm.formState.errors.token && (
                                    <p className="text-red-500 text-xs mt-1">
                                        {resetForm.formState.errors.token.message}
                                    </p>
                                )}
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    New Password
                                </label>
                                <input
                                    {...resetForm.register('password')}
                                    type="password"
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                    placeholder="••••••••"
                                />
                                {resetForm.formState.errors.password && (
                                    <p className="text-red-500 text-xs mt-1">
                                        {resetForm.formState.errors.password.message}
                                    </p>
                                )}
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Confirm Password
                                </label>
                                <input
                                    {...resetForm.register('confirmPassword')}
                                    type="password"
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                    placeholder="••••••••"
                                />
                                {resetForm.formState.errors.confirmPassword && (
                                    <p className="text-red-500 text-xs mt-1">
                                        {resetForm.formState.errors.confirmPassword.message}
                                    </p>
                                )}
                            </div>

                            <button
                                type="submit"
                                disabled={resetForm.formState.isSubmitting}
                                className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {resetForm.formState.isSubmitting ? 'Resetting...' : 'Reset Password'}
                            </button>
                        </form>

                        <button
                            type="button"
                            onClick={() => setStep('request')}
                            className="mt-4 w-full text-center text-sm text-blue-600 hover:underline"
                        >
                            Didn&apos;t receive the email? Try again
                        </button>
                    </>
                )}

                {/* ── Step 3: Done ── */}
                {step === 'done' && (
                    <div className="text-center py-4">
                        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
                            <CheckCircle2 className="h-7 w-7 text-green-600" />
                        </div>
                        <h2 className="text-xl font-bold text-gray-900 mb-2">Password Reset!</h2>
                        <p className="text-gray-500 mb-6">
                            Your password has been changed. You can now sign in with your new password.
                        </p>
                        <Link
                            to="/login"
                            className="inline-block w-full bg-blue-600 text-white py-2.5 rounded-lg font-semibold hover:bg-blue-700 transition-colors text-center"
                        >
                            Sign In
                        </Link>
                    </div>
                )}
            </div>
        </div>
    )
}

export default ForgotPassword
